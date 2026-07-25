import { useEffect } from 'react';

export interface KeyboardShortcutHandlers {
  onDelete?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onDuplicate?: () => void;
  onSelectAll?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPlayPause?: () => void;
  onFrameForward?: (frames: number) => void;
  onFrameBackward?: (frames: number) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

/**
 * 键盘快捷键 Hook
 * 处理时间轴编辑器的所有键盘快捷键
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // 防止在输入框中触发快捷键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Delete / Backspace - 删除选中项
      if ((e.key === 'Delete' || e.key === 'Backspace') && !cmdOrCtrl) {
        e.preventDefault();
        handlers.onDelete?.();
        return;
      }

      // Cmd/Ctrl + C - 复制
      if (e.key === 'c' && cmdOrCtrl && !e.shiftKey) {
        e.preventDefault();
        handlers.onCopy?.();
        return;
      }

      // Cmd/Ctrl + V - 粘贴
      if (e.key === 'v' && cmdOrCtrl && !e.shiftKey) {
        e.preventDefault();
        handlers.onPaste?.();
        return;
      }

      // Cmd/Ctrl + D - 复制（在原位置后方）
      if (e.key === 'd' && cmdOrCtrl && !e.shiftKey) {
        e.preventDefault();
        handlers.onDuplicate?.();
        return;
      }

      // Cmd/Ctrl + A - 全选
      if (e.key === 'a' && cmdOrCtrl && !e.shiftKey) {
        e.preventDefault();
        handlers.onSelectAll?.();
        return;
      }

      // Cmd/Ctrl + Z - 撤销
      if (e.key === 'z' && cmdOrCtrl && !e.shiftKey) {
        e.preventDefault();
        handlers.onUndo?.();
        return;
      }

      // Cmd/Ctrl + Shift + Z - 重做
      if (e.key === 'z' && cmdOrCtrl && e.shiftKey) {
        e.preventDefault();
        handlers.onRedo?.();
        return;
      }

      // Ctrl + Y - Windows/Linux redo convention
      if (e.key.toLowerCase() === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        handlers.onRedo?.();
        return;
      }

      // Space - 播放/暂停
      if (e.key === ' ' && !cmdOrCtrl) {
        e.preventDefault();
        handlers.onPlayPause?.();
        return;
      }

      // Arrow Left - 向后移动播放头
      if (e.key === 'ArrowLeft' && !cmdOrCtrl) {
        e.preventDefault();
        const frames = e.shiftKey ? 10 : 1;
        handlers.onFrameBackward?.(frames);
        return;
      }

      // Arrow Right - 向前移动播放头
      if (e.key === 'ArrowRight' && !cmdOrCtrl) {
        e.preventDefault();
        const frames = e.shiftKey ? 10 : 1;
        handlers.onFrameForward?.(frames);
        return;
      }

      // Cmd/Ctrl + = 或 + - 放大
      if ((e.key === '=' || e.key === '+') && cmdOrCtrl) {
        e.preventDefault();
        handlers.onZoomIn?.();
        return;
      }

      // Cmd/Ctrl + - - 缩小
      if (e.key === '-' && cmdOrCtrl) {
        e.preventDefault();
        handlers.onZoomOut?.();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handlers, enabled]);
}
