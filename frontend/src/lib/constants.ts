// API Configuration
// In development, connect directly to backend on port 3000
// In production, use same host (reverse proxy handles routing)
const isDev = import.meta.env.DEV;
const backendHost = isDev ? 'localhost:3000' : window.location.host;

export const API_BASE_URL = '/api';
export const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${backendHost}/ws`;

// Window defaults
export const DEFAULT_WINDOW_WIDTH = 800;
export const DEFAULT_WINDOW_HEIGHT = 600;
export const MIN_WINDOW_WIDTH = 300;
export const MIN_WINDOW_HEIGHT = 200;
export const TASKBAR_HEIGHT = 40; // legacy, kept for compat
export const MENUBAR_HEIGHT = 40;
export const DOCK_HEIGHT = 80; // dock bar height including magnification space
export const TITLEBAR_HEIGHT = 28;

// Z-index layers
export const Z_INDEX = {
  desktop: 0,
  desktopIcon: 10,
  window: 100,
  windowFocused: 200,

  taskbar: 900,
  menu: 950,
  startMenu: 950,
  modal: 1000,
  tooltip: 1100,
  notification: 1200,
} as const;

// Keyboard shortcuts
export const SHORTCUTS = {
  // Window management
  CLOSE_WINDOW: ['Alt+F4', 'Meta+w'],
  MINIMIZE_WINDOW: ['Alt+m'],
  MAXIMIZE_WINDOW: ['Alt+Enter', 'F11'],
  CYCLE_WINDOWS: ['Alt+Tab'],
  CYCLE_WINDOWS_REVERSE: ['Alt+Shift+Tab'],
  SHOW_DESKTOP: ['Alt+d', 'Meta+d'],
  
  // Menu
  TOGGLE_START_MENU: ['Meta', 'Super'],
  
  // Apps
  OPEN_TERMINAL: ['Ctrl+Alt+t'],
  

} as const;

// Desktop icon grid
export const ICON_GRID = {
  cellWidth: 80,
  cellHeight: 90,
  padding: 10,
} as const;

// Animation durations (ms)
export const ANIMATION = {
  fast: 100,
  normal: 200,
  slow: 300,
} as const;

// Local storage keys
export const STORAGE_KEYS = {
  token: 'construct:token',
  theme: 'construct:theme',
  soundEnabled: 'construct:sound',
  windowPositions: 'construct:windows',
} as const;
