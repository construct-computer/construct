export type WindowType = 
  | 'browser' 
  | 'terminal' 
  | 'files' 
  | 'editor' 
  | 'chat' 
  | 'settings' 
  | 'computer'
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
  
  // State
  state: WindowState;
  zIndex: number;
  
  // Optional agent association
  agentId?: string;
  
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
