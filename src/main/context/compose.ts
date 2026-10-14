import type { ClipboardEntry } from './clipboard.js';
import type { ScreenshotContext } from './screenshot.js';
import type { WindowContext } from './window.js';

export interface ContextBlock {
  window: WindowContext | null;
  clipboard: ClipboardEntry[];
  screenshot: ScreenshotContext | null;
}

/**
 * Captured text is untrusted (window titles, clipboard): keep it on one line
 * and stop it from closing the `<!-- … -->` wrapper early.
 */
function sanitize(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/-->/g, '-- >').trim();
}

export function composeContextBlock(ctx: ContextBlock): string {
  const parts: string[] = [];

  if (ctx.window) {
    parts.push(
      `<!-- context: app=${sanitize(ctx.window.processName)}, window="${sanitize(ctx.window.windowTitle)}", os=${ctx.window.os} -->`,
    );
  }

  if (ctx.clipboard.length > 0) {
    ctx.clipboard.forEach((entry, i) => {
      parts.push(`<!-- clipboard[${i}]: "${sanitize(entry.text)}" -->`);
    });
  }

  if (ctx.screenshot) {
    parts.push(
      `<!-- screenshot: ${ctx.screenshot.width}x${ctx.screenshot.height} ${ctx.screenshot.mimeType} -->`,
    );
  }

  return parts.join('\n');
}
