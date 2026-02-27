import type { ResizeHandle } from '@/types';

interface ResizeHandlesProps {
  onResizeStart: (handle: ResizeHandle, e: React.MouseEvent) => void;
  disabled?: boolean;
}

const handlePositions: Record<ResizeHandle, string> = {
  n: 'top-0 left-2 right-2 h-1 cursor-n-resize',
  s: 'bottom-0 left-2 right-2 h-1 cursor-s-resize',
  e: 'right-0 top-2 bottom-2 w-1 cursor-e-resize',
  w: 'left-0 top-2 bottom-2 w-1 cursor-w-resize',
  nw: 'top-0 left-0 w-2 h-2 cursor-nw-resize',
  ne: 'top-0 right-0 w-2 h-2 cursor-ne-resize',
  sw: 'bottom-0 left-0 w-2 h-2 cursor-sw-resize',
  se: 'bottom-0 right-0 w-2 h-2 cursor-se-resize',
};

const handles: ResizeHandle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

export function ResizeHandles({ onResizeStart, disabled }: ResizeHandlesProps) {
  if (disabled) return null;
  
  return (
    <>
      {handles.map((handle) => (
        <div
          key={handle}
          className={`absolute ${handlePositions[handle]} z-10`}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onResizeStart(handle, e);
          }}
        />
      ))}
    </>
  );
}
