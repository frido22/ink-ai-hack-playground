// SmartCanvas Element Plugin
//
// AI-powered drawing canvas that understands handwritten instructions.
// Draw anything, then write text like "improve", "add sunset", or "animate 4s"
// and the AI executes the command.
//
// Importing this module automatically registers the plugin.

import type { SmartCanvasElement } from './types';
import { createSmartCanvasElement, SMART_CANVAS_SIZE } from './types';
import type { ElementPlugin } from '../registry/ElementPlugin';
import { registerPlugin } from '../registry/ElementRegistry';
import { isInterestedIn, acceptInk } from './interaction';
import { render, getBounds } from './renderer';
import { registerPaletteEntry } from '../../palette/PaletteRegistry';
import { SmartCanvasIcon } from './icon';

const smartCanvasPlugin: ElementPlugin<SmartCanvasElement> = {
  elementType: 'smartCanvas',
  name: 'Smart Canvas',
  triesEagerInteractions: true,
  isInterestedIn,
  acceptInk,
  render,
  getBounds,
};

registerPlugin(smartCanvasPlugin);

registerPaletteEntry({
  id: 'smartCanvas',
  label: 'Smart Canvas',
  Icon: SmartCanvasIcon,
  category: 'content',
  onSelect: async (bounds, consumeStrokes) => {
    const rectWidth = bounds.right - bounds.left;
    const rectHeight = bounds.bottom - bounds.top;
    const size = Math.max(rectWidth, rectHeight, SMART_CANVAS_SIZE);
    const scale = size / SMART_CANVAS_SIZE;

    const element = createSmartCanvasElement(bounds.left, bounds.top);
    consumeStrokes();

    return { ...element, scaleX: scale, scaleY: scale };
  },
});

export { smartCanvasPlugin };
