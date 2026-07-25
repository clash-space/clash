/**
 * 时间格式化工具函数
 */

/**
 * 将帧数转换为 MM:SS:FF 格式
 * @param frame 帧数
 * @param fps 帧率
 * @returns 格式化的时间字符串
 */
export function formatTime(frame: number, fps: number): string {
  const totalSeconds = Math.floor(frame / fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const frames = frame % fps;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

/** Format a frame position as the editor-standard HH:MM:SS:FF timecode. */
export function formatTimecode(frame: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps));
  const safeFrame = Math.max(0, Math.floor(frame));
  const totalSeconds = Math.floor(safeFrame / safeFps);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const frames = safeFrame % safeFps;

  return [hours, minutes, seconds, frames]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/**
 * 将帧数转换为秒数
 * @param frame 帧数
 * @param fps 帧率
 * @returns 秒数
 */
export function framesToSeconds(frame: number, fps: number): number {
  return frame / fps;
}

/**
 * 将秒数转换为帧数
 * @param seconds 秒数
 * @param fps 帧率
 * @returns 帧数
 */
export function secondsToFrames(seconds: number, fps: number): number {
  // Quantize media time to the timeline frame grid using a conservative rule:
  // floor to avoid creating an extra (blank) frame due to container overhangs.
  // Add a tiny epsilon to counter floating rounding noise.
  return Math.floor(seconds * fps + 1e-6);
}

/**
 * 将像素位置转换为帧数
 * @param pixels 像素位置
 * @param pixelsPerFrame 每帧的像素数
 * @returns 帧数
 */
export function pixelsToFrame(pixels: number, pixelsPerFrame: number): number {
  return Math.round(pixels / pixelsPerFrame);
}

/**
 * 将帧数转换为像素位置
 * @param frame 帧数
 * @param pixelsPerFrame 每帧的像素数
 * @returns 像素位置
 */
export function frameToPixels(frame: number, pixelsPerFrame: number): number {
  return frame * pixelsPerFrame;
}

/**
 * 根据缩放级别获取每帧的像素数
 * @param zoom 缩放级别
 * @returns 每帧的像素数
 */
export function getPixelsPerFrame(zoom: number): number {
  return 2 * zoom;
}

/**
 * 获取时间标尺的刻度间隔
 * 根据缩放级别自动调整刻度密度
 * @param zoom 缩放级别
 * @returns 主刻度间隔（帧数）
 */
// Note: previous getRulerInterval/getSubInterval utilities were removed.
// The ruler now derives tick density from pixel spacing directly inside TimelineRuler.tsx
