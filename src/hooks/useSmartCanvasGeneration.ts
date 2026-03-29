// Hook that watches SmartCanvasElements for new strokes and triggers
// intent detection + action execution after a 4-second debounce.
//
// Longer debounce than SketchableImage (4s vs 3s) because the user
// may be writing text instructions which take more time.

import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { NoteElements } from '../types';
import type { SmartCanvasElement } from '../elements/smartcanvas/types';
import { detectIntent } from '../elements/smartcanvas/intentDetector';
import { enhanceDrawing } from '../elements/smartcanvas/actions/enhance';
import { modifyDrawing } from '../elements/smartcanvas/actions/modify';
import { animateDrawing } from '../elements/smartcanvas/actions/animate';
import {
  composeSmartCanvasImage,
  normalizeSmartCanvasLineArt,
  preloadImage,
  releaseSmartCanvasVideo,
} from '../elements/smartcanvas/renderer';
import { showToast } from '../toast/Toast';
import { isOpenRouterConfigured } from '../ai/OpenRouterService';
import { debugLog } from '../debug/DebugLogger';

const DEBOUNCE_MS = 4000;
const RETRY_DELAY_MS = 1500;
const MAX_AUTO_RETRIES = 2;

export function useSmartCanvasGeneration(
  currentNote: NoteElements,
  setCurrentNote: (value: NoteElements) => void,
): void {
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const lastAttemptedRef = useRef(new Map<string, number>());
  const retryCountsRef = useRef(new Map<string, number>());
  const requestVersionRef = useRef(new Map<string, number>());
  const latestNoteRef = useRef(currentNote);
  latestNoteRef.current = currentNote;

  const syncSetCurrentNote = useCallback((note: NoteElements) => {
    latestNoteRef.current = note;
    setCurrentNote(note);
  }, [setCurrentNote]);

  const updateElement = useCallback(
    (elementId: string, updater: (el: SmartCanvasElement) => SmartCanvasElement) => {
      const note = latestNoteRef.current;
      if (!note.elements.some(el => el.id === elementId && el.type === 'smartCanvas')) return;
      syncSetCurrentNote({
        ...note,
        elements: note.elements.map(el =>
          el.id === elementId && el.type === 'smartCanvas'
            ? updater(el as SmartCanvasElement)
            : el,
        ),
      });
    },
    [syncSetCurrentNote],
  );

  const triggerProcessing = useCallback(async (elementId: string) => {
    console.log('[SmartCanvas] triggerProcessing called', elementId);
    debugLog.info('SmartCanvas: trigger processing', { elementId: elementId.slice(0, 8) });

    if (!isOpenRouterConfigured()) {
      console.log('[SmartCanvas] OpenRouter not configured');
      debugLog.warn('SmartCanvas: OpenRouter not configured');
      showToast('Smart Canvas requires INK_OPENROUTER_API_KEY');
      return;
    }

    const note = latestNoteRef.current;
    const element = note.elements.find(
      (el): el is SmartCanvasElement => el.type === 'smartCanvas' && el.id === elementId,
    );
    if (!element || element.overlayStrokes.length === 0) {
      console.log('[SmartCanvas] no element or no strokes', { found: !!element, strokes: element?.overlayStrokes.length });
      debugLog.warn('SmartCanvas: no element or no strokes', {
        elementId: elementId.slice(0, 8),
        found: !!element,
        strokes: element?.overlayStrokes.length ?? 0,
      });
      return;
    }

    const strokeCount = element.overlayStrokes.length;
    const visibleStrokes = element.overlayStrokes.slice(element.processedStrokeCount);
    if (visibleStrokes.length === 0) {
      console.log('[SmartCanvas] no visible new strokes to process');
      debugLog.info('SmartCanvas: no visible new strokes', { elementId: elementId.slice(0, 8) });
      return;
    }

    console.log('[SmartCanvas] processing', strokeCount, 'strokes');
    debugLog.info('SmartCanvas: processing strokes', {
      elementId: elementId.slice(0, 8),
      totalStrokes: strokeCount,
      visibleStrokes: visibleStrokes.length,
      hasBitmap: !!element.bitmapDataUrl,
    });
    lastAttemptedRef.current.set(elementId, strokeCount);

    // Abort any in-flight request
    controllersRef.current.get(elementId)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(elementId, controller);
    const requestVersion = (requestVersionRef.current.get(elementId) ?? 0) + 1;
    requestVersionRef.current.set(elementId, requestVersion);

    const isCurrentRequest = () =>
      requestVersionRef.current.get(elementId) === requestVersion &&
      !controller.signal.aborted;

    // Composite strokes into a PNG for the LLM
    console.log('[SmartCanvas] compositing strokes to image...');
    const compositeImage = await composeSmartCanvasImage(
      element.bitmapDataUrl,
      visibleStrokes,
    );
    console.log('[SmartCanvas] composite image length:', compositeImage.length);
    debugLog.info('SmartCanvas: composed image', {
      elementId: elementId.slice(0, 8),
      dataUrlLength: compositeImage.length,
    });

    // Phase 1: Detect intent
    console.log('[SmartCanvas] Phase 1: detecting intent...');
    updateElement(elementId, el => ({ ...el, status: 'detecting' }));

    try {
      const intent = await detectIntent(compositeImage, controller.signal);
      if (!isCurrentRequest()) return;
      console.log('[SmartCanvas] intent detected:', JSON.stringify(intent));
      debugLog.info('SmartCanvas: intent detected', {
        elementId: elementId.slice(0, 8),
        action: intent.action,
        instruction: intent.instruction,
        motionDescription: intent.motionDescription,
        durationSeconds: intent.durationSeconds,
      });

      if (intent.action === 'none') {
        retryCountsRef.current.delete(elementId);
        debugLog.info('SmartCanvas: intent none', { elementId: elementId.slice(0, 8) });
        updateElement(elementId, el => ({
          ...el,
          status: 'idle',
          lastIntent: intent,
        }));
        return;
      }

      // Phase 2: Execute action
      updateElement(elementId, el => ({
        ...el,
        status: 'generating',
        lastIntent: intent,
      }));

      if (intent.action === 'enhance') {
        console.log('[SmartCanvas] Phase 2: enhancing...');
        debugLog.info('SmartCanvas: enhancing', {
          elementId: elementId.slice(0, 8),
          instruction: intent.instruction || 'enhance the whole drawing',
        });
        const generatedImage = await enhanceDrawing(
          compositeImage,
          intent.instruction || 'enhance the whole drawing',
          controller.signal,
        );
        if (!isCurrentRequest()) return;
        const resultImage = await normalizeSmartCanvasLineArt(generatedImage);
        if (!isCurrentRequest()) return;
        await preloadImage(resultImage);
        if (!isCurrentRequest()) return;
        retryCountsRef.current.delete(elementId);
        releaseSmartCanvasVideo(elementId);
        updateElement(elementId, el => ({
          ...el,
          bitmapDataUrl: resultImage,
          videoUrl: '',
          videoDurationMs: 0,
          processedStrokeCount: strokeCount,
          status: 'done',
        }));
        debugLog.action('SmartCanvas: enhancement complete', {
          elementId: elementId.slice(0, 8),
          imageDataUrlLength: resultImage.length,
        });
        showToast('Drawing enhanced');
      } else if (intent.action === 'modify') {
        console.log('[SmartCanvas] Phase 2: modifying...', intent.instruction);
        debugLog.info('SmartCanvas: modifying', {
          elementId: elementId.slice(0, 8),
          instruction: intent.instruction,
        });
        const generatedImage = await modifyDrawing(
          compositeImage,
          intent.instruction,
          controller.signal,
        );
        if (!isCurrentRequest()) return;
        const resultImage = await normalizeSmartCanvasLineArt(generatedImage);
        if (!isCurrentRequest()) return;
        await preloadImage(resultImage);
        if (!isCurrentRequest()) return;
        retryCountsRef.current.delete(elementId);
        releaseSmartCanvasVideo(elementId);
        updateElement(elementId, el => ({
          ...el,
          bitmapDataUrl: resultImage,
          videoUrl: '',
          videoDurationMs: 0,
          processedStrokeCount: strokeCount,
          status: 'done',
        }));
        debugLog.action('SmartCanvas: modification complete', {
          elementId: elementId.slice(0, 8),
          imageDataUrlLength: resultImage.length,
        });
        showToast(`Modified: ${intent.instruction}`);
      } else if (intent.action === 'animate') {
        const rawMotionDescription = intent.motionDescription?.trim() ?? '';
        const rawInstruction = intent.instruction?.trim() ?? '';
        const motionDescription =
          rawMotionDescription &&
          rawMotionDescription.toLowerCase() !== 'no specific motion described'
            ? rawMotionDescription
            : rawInstruction &&
                rawInstruction.toLowerCase() !== 'animate' &&
                rawInstruction.toLowerCase() !== 'animate the drawing'
              ? rawInstruction
              : 'apply subtle natural motion that fits the scene while preserving the sketch';

        console.log('[SmartCanvas] Phase 2: animating...', motionDescription);
        debugLog.info('SmartCanvas: animating', {
          elementId: elementId.slice(0, 8),
          motionDescription,
          durationSeconds: intent.durationSeconds || 8,
        });
        const result = await animateDrawing(
          compositeImage,
          motionDescription,
          intent.durationSeconds || 8,
          controller.signal,
        );
        if (!isCurrentRequest()) return;
        await preloadImage(result.posterDataUrl);
        if (!isCurrentRequest()) return;
        retryCountsRef.current.delete(elementId);
        updateElement(elementId, el => ({
          ...el,
          bitmapDataUrl: result.posterDataUrl,
          videoUrl: result.videoBlobUrl,
          videoDurationMs: result.durationMs,
          processedStrokeCount: strokeCount,
          status: 'done',
        }));
        debugLog.action('SmartCanvas: animation complete', {
          elementId: elementId.slice(0, 8),
          videoDurationMs: result.durationMs,
        });
        showToast('Animation ready');
      }

      // Fade border back to idle after 2 seconds
      setTimeout(() => {
        if (requestVersionRef.current.get(elementId) !== requestVersion) return;
        updateElement(elementId, el =>
          el.status === 'done' ? { ...el, status: 'idle' } : el,
        );
      }, 2000);

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        retryCountsRef.current.delete(elementId);
        debugLog.info('SmartCanvas: request aborted', { elementId: elementId.slice(0, 8) });
        updateElement(elementId, el => ({ ...el, status: 'idle' }));
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);
      const retryCount = retryCountsRef.current.get(elementId) ?? 0;

      if (isCurrentRequest() && retryCount < MAX_AUTO_RETRIES) {
        retryCountsRef.current.set(elementId, retryCount + 1);
        console.warn('[SmartCanvas] retrying after error:', msg);
        debugLog.warn('SmartCanvas: retrying after error', {
          elementId: elementId.slice(0, 8),
          retryAttempt: retryCount + 1,
          error: msg,
        });
        updateElement(elementId, el => ({ ...el, status: 'idle' }));

        const existingTimer = timersRef.current.get(elementId);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(() => {
          timersRef.current.delete(elementId);
          triggerProcessing(elementId);
        }, RETRY_DELAY_MS * (retryCount + 1));
        timersRef.current.set(elementId, timer);
        return;
      }

      retryCountsRef.current.delete(elementId);
      console.error('[SmartCanvas] ERROR:', msg, err);
      debugLog.error('SmartCanvas: request failed', {
        elementId: elementId.slice(0, 8),
        error: msg,
      });
      showToast(`Smart Canvas: ${msg}`);
      updateElement(elementId, el => ({ ...el, status: 'idle' }));
    } finally {
      if (requestVersionRef.current.get(elementId) === requestVersion) {
        controllersRef.current.delete(elementId);
      }

      const latestElement = latestNoteRef.current.elements.find(
        (el): el is SmartCanvasElement => el.type === 'smartCanvas' && el.id === elementId,
      );
      const lastAttempted = lastAttemptedRef.current.get(elementId) ?? 0;
      const hasPendingTimer = timersRef.current.has(elementId);
      if (
        latestElement &&
        latestElement.status !== 'detecting' &&
        latestElement.status !== 'generating' &&
        latestElement.overlayStrokes.length > lastAttempted &&
        !hasPendingTimer
      ) {
        const timer = setTimeout(() => {
          timersRef.current.delete(elementId);
          triggerProcessing(elementId);
        }, DEBOUNCE_MS);
        timersRef.current.set(elementId, timer);
      }
    }
  }, [updateElement]);

  // Fingerprint: only changes when stroke counts change
  const fingerprint = useMemo(() => {
    return currentNote.elements
      .filter((el): el is SmartCanvasElement => el.type === 'smartCanvas')
      .map(el => `${el.id}:${el.overlayStrokes.length}`)
      .join(',');
  }, [currentNote.elements]);

  useEffect(() => {
    const scElements = latestNoteRef.current.elements.filter(el => el.type === 'smartCanvas');
    if (scElements.length > 0) {
      console.log('[SmartCanvas] fingerprint effect, smartCanvas elements:', scElements.length);
    }
    for (const element of latestNoteRef.current.elements) {
      if (element.type !== 'smartCanvas') continue;
      if (element.status === 'detecting' || element.status === 'generating') continue;

      const lastAttempted = lastAttemptedRef.current.get(element.id) ?? 0;
      if (element.overlayStrokes.length <= lastAttempted) continue;

      const existing = timersRef.current.get(element.id);
      if (existing) clearTimeout(existing);

      controllersRef.current.get(element.id)?.abort();
      controllersRef.current.delete(element.id);

      const timer = setTimeout(() => {
        timersRef.current.delete(element.id);
        triggerProcessing(element.id);
      }, DEBOUNCE_MS);
      timersRef.current.set(element.id, timer);
    }
  }, [fingerprint, triggerProcessing]);

  // Cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current;
    const controllers = controllersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const c of controllers.values()) c.abort();
      controllers.clear();
    };
  }, []);
}
