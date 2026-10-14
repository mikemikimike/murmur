import { getActiveWindow } from '@nut-tree-fork/nut-js';

export interface WindowContext {
  processName: string;
  windowTitle: string;
  os: string;
}

const MAX_TITLE_LENGTH = 100;

function getOsName(): string {
  switch (process.platform) {
    case 'win32':
      return 'Windows';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return process.platform;
  }
}

function extractProcessName(title: string): string {
  const patterns = [
    /(?:-\s*)([^-\s]+)$/,
    /(?:—\s*)([^—\s]+)$/,
    /(?:\|\s*)([^|]+)$/,
    /(?:•\s*)([^•]+)$/,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return 'unknown';
}

export async function captureActiveWindow(): Promise<WindowContext | null> {
  try {
    const window = await getActiveWindow();
    const title = await window.title;

    return {
      processName: extractProcessName(title),
      windowTitle: title.slice(0, MAX_TITLE_LENGTH),
      os: getOsName(),
    };
  } catch (err) {
    console.warn('[context] failed to capture active window:', err);
    return null;
  }
}
