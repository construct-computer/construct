import { useEffect, useCallback, useRef } from 'react';
import { useWindowStore } from '@/stores/windowStore';
import { useSound } from './useSound';

interface ShortcutHandlers {
  onOpenTerminal?: () => void;
  onToggleStartMenu?: () => void;
}

/**
 * Hook to handle global keyboard shortcuts
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers = {}) {
  const { play } = useSound();
  const {
    focusedWindowId,
    closeWindow,
    minimizeWindow,
    toggleMaximize,
    minimizeAll,
    cycleWindows,
  } = useWindowStore();
  
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const { altKey, ctrlKey, metaKey, shiftKey, key } = e;
      
      // Ignore if typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      
      // Alt+F4 or Cmd+W - Close window
      if ((altKey && key === 'F4') || (metaKey && key === 'w')) {
        e.preventDefault();
        if (focusedWindowId) {
          play('close');
          closeWindow(focusedWindowId);
        }
        return;
      }
      
      // Alt+M - Minimize window
      if (altKey && key.toLowerCase() === 'm') {
        e.preventDefault();
        if (focusedWindowId) {
          play('minimize');
          minimizeWindow(focusedWindowId);
        }
        return;
      }
      
      // Alt+Enter or F11 - Toggle maximize
      if ((altKey && key === 'Enter') || key === 'F11') {
        e.preventDefault();
        if (focusedWindowId) {
          play('maximize');
          toggleMaximize(focusedWindowId);
        }
        return;
      }
      
      // Alt+Tab / Alt+Shift+Tab - Cycle windows
      if (altKey && key === 'Tab') {
        e.preventDefault();
        play('click');
        cycleWindows(shiftKey);
        return;
      }
      
      // Alt+D or Meta+D - Show desktop (minimize all)
      if ((altKey || metaKey) && key.toLowerCase() === 'd') {
        e.preventDefault();
        play('minimize');
        minimizeAll();
        return;
      }
      
      // Ctrl+Alt+T - Open terminal
      if (ctrlKey && altKey && key.toLowerCase() === 't') {
        e.preventDefault();
        play('open');
        handlersRef.current.onOpenTerminal?.();
        return;
      }
      
      // Meta/Super key alone - Toggle start menu
      if ((key === 'Meta' || key === 'Super') && !altKey && !ctrlKey && !shiftKey) {
        // Only trigger on keyup for single Meta press
        return;
      }
      
      // Alt+1-9 - Focus window by taskbar position
      if (altKey && key >= '1' && key <= '9') {
        e.preventDefault();
        // TODO: Implement taskbar position focus
        return;
      }
      
      // Escape - Close menus
      if (key === 'Escape') {
        // Let other handlers deal with this
        return;
      }
    },
    [
      focusedWindowId,
      closeWindow,
      minimizeWindow,
      toggleMaximize,
      minimizeAll,
      cycleWindows,
      play,
    ]
  );
  
  // Handle Meta key release for start menu
  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Super') {
        // Check if it was a clean press (no other keys)
        // This is a simplified check - a more robust implementation would
        // track key states
        handlersRef.current.onToggleStartMenu?.();
      }
    },
    []
  );
  
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    // window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);
}
