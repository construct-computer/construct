export type WindowType = 
  | 'browser' 
  | 'terminal' 
  | 'files' 
  | 'editor' 
  | 'chat' 
  | 'settings' 
  | 'about'
  | 'setup';

export type WindowState = 'normal' | 'minimized' | 'maximized';

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowBounds extends WindowPosition, WindowSize {}

export interface WindowConfig {
  id: string;
  type: WindowType;
  title: string;
  icon?: string;
  
  // Position and size
  x: number;
  y: number;
  width: number;
  height: number;
  
  // Constraints
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
  
  // Aspect ratio constraint for the content area (width / height).
  // Only enforced during resize when lockAspectRatio is true.
  aspectRatio?: number;
  // Height of window chrome (titlebar + toolbars) to subtract when computing
  // content area for aspect ratio enforcement.
  chromeHeight?: number;
  // When true, resizing maintains the aspectRatio for the content area.
  lockAspectRatio?: boolean;
  
  // State
  state: WindowState;
  zIndex: number;
  
  // Optional agent association
  agentId?: string;
  
  // Arbitrary per-window data (e.g. filePath for editor windows)
  metadata?: Record<string, unknown>;
  
  // For restoring from maximized/minimized
  previousBounds?: WindowBounds;
}

export interface DragState {
  isDragging: boolean;
  windowId: string | null;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

export interface ResizeState {
  isResizing: boolean;
  windowId: string | null;
  handle: ResizeHandle | null;
  startX: number;
  startY: number;
  startBounds: WindowBounds | null;
}

export type ResizeHandle = 
  | 'n' | 's' | 'e' | 'w' 
  | 'nw' | 'ne' | 'sw' | 'se';
