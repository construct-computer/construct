import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { WindowConfig, WindowType, WindowBounds } from '@/types';
import { generateId, clamp } from '@/lib/utils';
import {
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MENUBAR_HEIGHT,
  DOCK_HEIGHT,
  Z_INDEX,
} from '@/lib/constants';

interface WindowStore {
  windows: WindowConfig[];
  focusedWindowId: string | null;
  nextZIndex: number;
  
  // Actions
  openWindow: (type: WindowType, options?: Partial<WindowConfig>) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  
  // Position/size
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, width: number, height: number) => void;
  setBounds: (id: string, bounds: Partial<WindowBounds>) => void;
  
  // Bulk actions
  minimizeAll: () => void;
  closeAll: () => void;
  
  // Helpers
  getWindow: (id: string) => WindowConfig | undefined;
  getWindowsByType: (type: WindowType) => WindowConfig[];
  getWindowsByAgent: (agentId: string) => WindowConfig[];
  getFocusedWindow: () => WindowConfig | undefined;
  cycleWindows: (reverse?: boolean) => void;
  
  // Ensure a window of this type is open and focused (no duplicates)
  ensureWindowOpen: (type: WindowType) => void;
  
  // Open multiple windows arranged in a tidy grid
  openWindowsGrid: (types: WindowType[]) => void;
}

// Window type default configurations
const windowDefaults: Record<WindowType, Partial<WindowConfig>> = {
  browser: {
    title: 'Browser',
    width: 960,
    height: 651,  // 540 content (16:9 at 960w) + 111 chrome
    minWidth: 400,
    minHeight: 336, // 225 content (16:9 at 400w) + 111 chrome
    maxWidth: 1920,
    maxHeight: 1191, // 1080 content (16:9 at 1920w) + 111 chrome
    aspectRatio: 16 / 9,
    chromeHeight: 111, // titlebar(32) + tabbar(23) + navbar(33) + statusbar(23)
  },
  terminal: {
    title: 'Terminal',
    width: 700,
    height: 450,
    minWidth: 350,
    minHeight: 200,
    maxWidth: 1600,
    maxHeight: 1000,
  },
  files: {
    title: 'Files',
    width: 600,
    height: 450,
    minWidth: 300,
    minHeight: 200,
    maxWidth: 1200,
    maxHeight: 900,
  },
  editor: {
    title: 'Editor',
    width: 800,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    maxWidth: 1600,
    maxHeight: 1200,
  },
  chat: {
    title: 'Construct Agent',
    width: 400,
    height: 500,
    minWidth: 300,
    minHeight: 300,
    maxWidth: 700,
    maxHeight: 900,
  },
  settings: {
    title: 'My Computer',
    width: 500,
    height: 600,
    minWidth: 400,
    minHeight: 400,
    maxWidth: 700,
    maxHeight: 900,
  },
  about: {
    title: 'About',
    width: 480,
    height: 480,
    minWidth: 380,
    minHeight: 400,
    maxWidth: 600,
    maxHeight: 600,
  },
  setup: {
    title: 'Welcome',
    width: 480,
    height: 580,
    minWidth: 400,
    minHeight: 480,
    maxWidth: 600,
    maxHeight: 700,
  },
};

/**
 * Compute a grid layout for N windows within the available screen area.
 * Returns an array of { x, y, width, height } for each window.
 */
function computeGridLayout(
  types: WindowType[],
  screenWidth: number,
  screenHeight: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const count = types.length;
  if (count === 0) return [];

  const padding = 16; // outer padding
  const gap = 12;     // gap between windows

  const availW = screenWidth - padding * 2;
  const availH = screenHeight - padding * 2;

  // Determine grid dimensions (cols x rows)
  let cols: number;
  let rows: number;
  if (count === 1) {
    cols = 1; rows = 1;
  } else if (count === 2) {
    cols = 2; rows = 1;
  } else if (count <= 4) {
    cols = 2; rows = 2;
  } else if (count <= 6) {
    cols = 3; rows = 2;
  } else {
    cols = 3; rows = Math.ceil(count / 3);
  }

  const cellW = Math.floor((availW - gap * (cols - 1)) / cols);
  const cellH = Math.floor((availH - gap * (rows - 1)) / rows);

  // Cap window sizes at half the screen dimensions
  const halfW = Math.floor(screenWidth / 2);
  const halfH = Math.floor(screenHeight / 2);

  return types.map((type, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const defaults = windowDefaults[type] || {};
    const minW = defaults.minWidth ?? MIN_WINDOW_WIDTH;
    const minH = defaults.minHeight ?? MIN_WINDOW_HEIGHT;

    // Use the cell size but clamp between min and half-screen
    const w = clamp(cellW, minW, halfW);
    const h = clamp(cellH, minH, halfH);

    // Center window within its grid cell when capped
    const cellX = padding + col * (cellW + gap);
    const cellY = padding + row * (cellH + gap);
    const x = cellX + Math.max(0, Math.floor((cellW - w) / 2));
    const y = cellY + Math.max(0, Math.floor((cellH - h) / 2));

    return { x, y, width: w, height: h };
  });
}

// Calculate cascaded position (offset from previous windows)
function getCascadedPosition(windows: WindowConfig[], width: number, height: number): { x: number; y: number } {
  const offset = 30;
  const baseX = 50;
  const baseY = 50;
  
  const x = baseX + (windows.length % 10) * offset;
  const y = baseY + (windows.length % 10) * offset;
  
  const maxX = window.innerWidth - width;
  const maxY = window.innerHeight - MENUBAR_HEIGHT - DOCK_HEIGHT - height;
  
  return {
    x: clamp(x, 0, Math.max(0, maxX)),
    y: clamp(y, 0, Math.max(0, maxY)),
  };
}

export const useWindowStore = create<WindowStore>()(
  subscribeWithSelector((set, get) => ({
    windows: [],
    focusedWindowId: null,
    nextZIndex: Z_INDEX.window,
    
    openWindow: (type, options = {}) => {
      const defaults = windowDefaults[type] || {};
      const width = options.width ?? defaults.width ?? DEFAULT_WINDOW_WIDTH;
      const height = options.height ?? defaults.height ?? DEFAULT_WINDOW_HEIGHT;
      
      const { windows, nextZIndex } = get();
      const position = options.x !== undefined && options.y !== undefined
        ? { x: options.x, y: options.y }
        : getCascadedPosition(windows, width, height);
      
      const id = options.id ?? generateId('window');
      
      const newWindow: WindowConfig = {
        id,
        type,
        title: options.title ?? defaults.title ?? type,
        icon: options.icon,
        x: position.x,
        y: position.y,
        width,
        height,
        minWidth: options.minWidth ?? defaults.minWidth ?? MIN_WINDOW_WIDTH,
        minHeight: options.minHeight ?? defaults.minHeight ?? MIN_WINDOW_HEIGHT,
        maxWidth: options.maxWidth ?? defaults.maxWidth,
        maxHeight: options.maxHeight ?? defaults.maxHeight,
        aspectRatio: options.aspectRatio ?? defaults.aspectRatio,
        chromeHeight: options.chromeHeight ?? defaults.chromeHeight,
        state: 'normal',
        zIndex: nextZIndex,
        agentId: options.agentId,
        metadata: options.metadata,
      };
      
      set({
        windows: [...windows, newWindow],
        focusedWindowId: id,
        nextZIndex: nextZIndex + 1,
      });
      
      return id;
    },
    
    closeWindow: (id) => {
      const { windows, focusedWindowId } = get();
      const newWindows = windows.filter((w) => w.id !== id);
      
      // If we closed the focused window, focus the next highest z-index window
      let newFocusedId = focusedWindowId;
      if (focusedWindowId === id) {
        const visibleWindows = newWindows.filter((w) => w.state !== 'minimized');
        if (visibleWindows.length > 0) {
          const highestWindow = visibleWindows.reduce((a, b) => 
            a.zIndex > b.zIndex ? a : b
          );
          newFocusedId = highestWindow.id;
        } else {
          newFocusedId = null;
        }
      }
      
      set({ windows: newWindows, focusedWindowId: newFocusedId });
    },
    
    focusWindow: (id) => {
      const { windows, nextZIndex, focusedWindowId } = get();
      if (id === focusedWindowId) return;
      
      const window = windows.find((w) => w.id === id);
      if (!window) return;
      
      // Restore if minimized
      const newState = window.state === 'minimized' ? 'normal' : window.state;
      
      set({
        windows: windows.map((w) =>
          w.id === id ? { ...w, zIndex: nextZIndex, state: newState } : w
        ),
        focusedWindowId: id,
        nextZIndex: nextZIndex + 1,
      });
    },
    
    minimizeWindow: (id) => {
      const { windows, focusedWindowId } = get();
      
      set({
        windows: windows.map((w) =>
          w.id === id ? { ...w, state: 'minimized' } : w
        ),
        focusedWindowId: focusedWindowId === id ? null : focusedWindowId,
      });
      
      // Focus next window
      if (focusedWindowId === id) {
        const visibleWindows = get().windows.filter(
          (w) => w.id !== id && w.state !== 'minimized'
        );
        if (visibleWindows.length > 0) {
          const highestWindow = visibleWindows.reduce((a, b) =>
            a.zIndex > b.zIndex ? a : b
          );
          get().focusWindow(highestWindow.id);
        }
      }
    },
    
    maximizeWindow: (id) => {
      const { windows, nextZIndex } = get();
      const window = windows.find((w) => w.id === id);
      if (!window) return;
      
      const screenWidth = globalThis.innerWidth;
      const screenHeight = globalThis.innerHeight - MENUBAR_HEIGHT;
      
      set({
        windows: windows.map((w) =>
          w.id === id
            ? {
                ...w,
                state: 'maximized',
                previousBounds: { x: w.x, y: w.y, width: w.width, height: w.height },
                x: 0,
                y: 0,
                width: screenWidth,
                height: screenHeight,
                zIndex: nextZIndex,
              }
            : w
        ),
        focusedWindowId: id,
        nextZIndex: nextZIndex + 1,
      });
    },
    
    restoreWindow: (id) => {
      const { windows, nextZIndex } = get();
      const window = windows.find((w) => w.id === id);
      if (!window) return;
      
      const bounds = window.previousBounds || {
        x: 100,
        y: 100,
        width: windowDefaults[window.type]?.width ?? DEFAULT_WINDOW_WIDTH,
        height: windowDefaults[window.type]?.height ?? DEFAULT_WINDOW_HEIGHT,
      };
      
      set({
        windows: windows.map((w) =>
          w.id === id
            ? {
                ...w,
                state: 'normal',
                ...bounds,
                zIndex: nextZIndex,
              }
            : w
        ),
        focusedWindowId: id,
        nextZIndex: nextZIndex + 1,
      });
    },
    
    toggleMaximize: (id) => {
      const window = get().windows.find((w) => w.id === id);
      if (!window) return;
      
      if (window.state === 'maximized') {
        get().restoreWindow(id);
      } else {
        get().maximizeWindow(id);
      }
    },
    
    moveWindow: (id, x, y) => {
      const { windows } = get();
      set({
        windows: windows.map((w) =>
          w.id === id ? { ...w, x, y, state: 'normal' } : w
        ),
      });
    },
    
    resizeWindow: (id, width, height) => {
      const { windows } = get();
      const window = windows.find((w) => w.id === id);
      if (!window) return;
      
      set({
        windows: windows.map((w) =>
          w.id === id
            ? {
                ...w,
                width: clamp(width, w.minWidth, w.maxWidth ?? Infinity),
                height: clamp(height, w.minHeight, w.maxHeight ?? Infinity),
                state: 'normal',
              }
            : w
        ),
      });
    },
    
    setBounds: (id, bounds) => {
      const { windows } = get();
      const window = windows.find((w) => w.id === id);
      if (!window) return;
      
      set({
        windows: windows.map((w) =>
          w.id === id
            ? {
                ...w,
                x: bounds.x ?? w.x,
                y: bounds.y ?? w.y,
                width: bounds.width !== undefined
                  ? clamp(bounds.width, w.minWidth, w.maxWidth ?? Infinity)
                  : w.width,
                height: bounds.height !== undefined
                  ? clamp(bounds.height, w.minHeight, w.maxHeight ?? Infinity)
                  : w.height,
              }
            : w
        ),
      });
    },
    
    minimizeAll: () => {
      const { windows } = get();
      set({
        windows: windows.map((w) => ({ ...w, state: 'minimized' })),
        focusedWindowId: null,
      });
    },
    
    closeAll: () => {
      set({ windows: [], focusedWindowId: null });
    },
    
    getWindow: (id) => get().windows.find((w) => w.id === id),
    
    getWindowsByType: (type) => get().windows.filter((w) => w.type === type),
    
    getWindowsByAgent: (agentId) => get().windows.filter((w) => w.agentId === agentId),
    
    getFocusedWindow: () => {
      const { windows, focusedWindowId } = get();
      return windows.find((w) => w.id === focusedWindowId);
    },
    
    cycleWindows: (reverse = false) => {
      const { windows, focusedWindowId } = get();
      const visibleWindows = windows
        .filter((w) => w.state !== 'minimized')
        .sort((a, b) => a.zIndex - b.zIndex);
      
      if (visibleWindows.length === 0) return;
      
      const currentIndex = visibleWindows.findIndex((w) => w.id === focusedWindowId);
      let nextIndex: number;
      
      if (currentIndex === -1) {
        nextIndex = 0;
      } else if (reverse) {
        nextIndex = (currentIndex - 1 + visibleWindows.length) % visibleWindows.length;
      } else {
        nextIndex = (currentIndex + 1) % visibleWindows.length;
      }
      
      get().focusWindow(visibleWindows[nextIndex].id);
    },
    
    ensureWindowOpen: (type) => {
      const { windows } = get();
      const visible = windows.find((w) => w.type === type && w.state !== 'minimized');
      if (visible) {
        get().focusWindow(visible.id);
        return;
      }
      const minimized = windows.find((w) => w.type === type && w.state === 'minimized');
      if (minimized) {
        get().focusWindow(minimized.id);
        return;
      }
      get().openWindow(type);
    },
    
    openWindowsGrid: (types) => {
      if (types.length === 0) return;
      
      // Filter out types that already have an open window
      const { windows } = get();
      const newTypes: WindowType[] = [];
      for (const type of types) {
        const existing = windows.find((w) => w.type === type);
        if (existing) {
          // Just focus / restore it
          get().focusWindow(existing.id);
        } else {
          newTypes.push(type);
        }
      }
      
      if (newTypes.length === 0) return;
      
      const screenWidth = globalThis.innerWidth;
      const screenHeight = globalThis.innerHeight - MENUBAR_HEIGHT;
      const grid = computeGridLayout(newTypes, screenWidth, screenHeight);
      
      for (let i = 0; i < newTypes.length; i++) {
        get().openWindow(newTypes[i], {
          x: grid[i].x,
          y: grid[i].y,
          width: grid[i].width,
          height: grid[i].height,
        });
      }
    },
  }))
);
