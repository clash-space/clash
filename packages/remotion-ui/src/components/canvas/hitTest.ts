import type { Item, Track } from '@master-clash/remotion-core';

/**
 * 测试点击点是否在元素内（支持旋转）
 */
export function testItemHit(
  clickX: number,
  clickY: number,
  item: Item,
  compositionWidth: number,
  compositionHeight: number
): boolean {
  const props = item.properties;
  
  // 如果元素没有 properties，跳过（不应该被点击）
  if (!props) {
    return false;
  }
  
  // 元素位置和大小（x,y 是相对于中心的偏移）
  const itemX = props.x ?? 0;
  const itemY = props.y ?? 0;
  const itemWidth = (props.width ?? 1) * compositionWidth;
  const itemHeight = (props.height ?? 1) * compositionHeight;
  const rotation = (props.rotation ?? 0) * (Math.PI / 180);

  // 将点击坐标转换到元素的本地坐标系（反向旋转）
  const dx = clickX - itemX;
  const dy = clickY - itemY;
  
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  // 检查是否在矩形范围内
  const halfWidth = itemWidth / 2;
  const halfHeight = itemHeight / 2;

  const isHit = (
    localX >= -halfWidth &&
    localX <= halfWidth &&
    localY >= -halfHeight &&
    localY <= halfHeight
  );

  return isHit;
}

/**
 * 查找点击位置最上层的元素
 * 返回: { itemId, trackId } 或 null
 */
export function findTopItemAtPoint(
  x: number,
  y: number,
  tracks: Track[],
  currentFrame: number,
  compositionWidth: number,
  compositionHeight: number
): { itemId: string; trackId: string } | null {
  // 从后往前遍历 tracks（后面的 track 在上层）
  for (let i = tracks.length - 1; i >= 0; i--) {
    const track = tracks[i];
    
    // 从后往前遍历该 track 的 items（后面的 item 在上层）
    for (let j = track.items.length - 1; j >= 0; j--) {
      const item = track.items[j];
      
      // 检查元素是否在当前帧可见
      const isVisible = 
        currentFrame >= item.from &&
        currentFrame < item.from + item.durationInFrames;
      
      if (!isVisible) continue;
      
      // 执行碰撞检测
      if (testItemHit(x, y, item, compositionWidth, compositionHeight)) {
        return { itemId: item.id, trackId: track.id };
      }
    }
  }
  
  return null;
}
