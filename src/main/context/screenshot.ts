import { desktopCapturer } from 'electron';

export interface ScreenshotContext {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

export async function captureScreenshot(): Promise<ScreenshotContext | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (sources.length === 0) {
      console.warn('[context] no screen sources available');
      return null;
    }

    const primarySource = sources[0];
    if (!primarySource) {
      return null;
    }

    const nativeImage = primarySource.thumbnail;
    const size = nativeImage.getSize();
    // JPEG keeps a 1080p screen around 150-300 KB instead of several MB of
    // PNG, which matters for request size and vision-model latency.
    const base64 = nativeImage.toJPEG(75).toString('base64');

    return {
      base64,
      mimeType: 'image/jpeg',
      width: size.width,
      height: size.height,
    };
  } catch (err) {
    console.warn('[context] failed to capture screenshot:', err);
    return null;
  }
}
