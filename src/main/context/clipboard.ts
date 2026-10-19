import { clipboard } from 'electron';

export interface ClipboardEntry {
  text: string;
  timestamp: number;
}

const MAX_ENTRY_LENGTH = 500;
const clipboardHistory: ClipboardEntry[] = [];
const MAX_HISTORY_SIZE = 5;

let lastClipboardText: string | null = null;
let monitoringInterval: NodeJS.Timeout | null = null;
let polling = false;

// Text Murmur itself put on the clipboard (pasted prompts). Without this the
// previous refined prompt would come back as "clipboard context" next time.
const ownWrites: string[] = [];
const MAX_OWN_WRITES = 10;

export function ignoreClipboardText(text: string): void {
  ownWrites.push(text);
  if (ownWrites.length > MAX_OWN_WRITES) ownWrites.shift();
}

export function startClipboardMonitoring(): void {
  if (monitoringInterval) return;

  // clipboard.readText() is async since Electron 44; `polling` keeps a slow read
  // from overlapping the next tick and from racing the initial seed read.
  polling = true;
  lastClipboardText = null;
  clipboard
    .readText()
    .then((text) => {
      lastClipboardText = text;
    })
    .catch(() => {})
    .finally(() => {
      polling = false;
    });

  monitoringInterval = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const currentText = await clipboard.readText();
      if (currentText && currentText !== lastClipboardText) {
        lastClipboardText = currentText;
        if (ownWrites.includes(currentText)) return;
        clipboardHistory.unshift({
          text: currentText.slice(0, MAX_ENTRY_LENGTH),
          timestamp: Date.now(),
        });
        if (clipboardHistory.length > MAX_HISTORY_SIZE) {
          clipboardHistory.pop();
        }
      }
    } catch {
    } finally {
      polling = false;
    }
  }, 500);
}

export function stopClipboardMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

export function getClipboardHistory(count: number): ClipboardEntry[] {
  return clipboardHistory.slice(0, count);
}

export function clearClipboardHistory(): void {
  clipboardHistory.length = 0;
}
