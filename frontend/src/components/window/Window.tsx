import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useWindowStore } from '@/stores/windowStore';
import { useSound } from '@/hooks/useSound';
import { TitleBar } from './TitleBar';
import { ResizeHandles } from './ResizeHandles';
import type { WindowConfig, ResizeHandle } from '@/types';
import { MENUBAR_HEIGHT } from '@/lib/constants';

interface WindowProps {
  config: WindowConfig;
  children: ReactNode;
}

export function Window({ config, children }: WindowProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startWindowX: number;
    startWindowY: number;
  } | null>(null);
  const resizeRef = useRef<{
    handle: ResizeHandle;
    startX: number;
    startY: number;
    startBounds: { x: number; y: number; width: number; height: number };
  } | null>(null);
  
  const { play } = useSound();
  const focusedWindowId = useWindowStore((s) => s.focusedWindowId);
  const {
    focusWindow,
    closeWindow,
    minimizeWindow,
    toggleMaximize,
    moveWindow,
    setBounds,
  } = useWindowStore();
  
  const isFocused = focusedWindowId === config.id;
  const isMaximized = config.state === 'maximized';
  const isMinimized = config.state === 'minimized';
  
  // Animation state
  const [animVisible, setAnimVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(true);
  const [animateBounds, setAnimateBounds] = useState(false);
  
  // Open / minimize / restore animation
  useEffect(() => {
    if (isMinimized) {
      setAnimVisible(false);
      const t = setTimeout(() => setShouldRender(false), 200);
      return () => clearTimeout(t);
    } else {
      setShouldRender(true);
      let cancelled = false;
      requestAnimationFrame(() => {
        if (!cancelled) requestAnimationFrame(() => {
          if (!cancelled) setAnimVisible(true);
        });
      });
      return () => { cancelled = true; };
    }
  }, [isMinimized]);
  
  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return;
    if (e.button !== 0) return;
    
    e.preventDefault();
    focusWindow(config.id);
    
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWindowX: config.x,
      startWindowY: config.y,
    };
    
    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
  }, [config.id, config.x, config.y, isMaximized, focusWindow]);
  
  // Handle resize start
  const handleResizeStart = useCallback((handle: ResizeHandle, e: React.MouseEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    e.stopPropagation();
    focusWindow(config.id);
    
    resizeRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startBounds: {
        x: config.x,
        y: config.y,
        width: config.width,
        height: config.height,
      },
    };
    
    document.body.style.userSelect = 'none';
  }, [config.id, config.x, config.y, config.width, config.height, isMaximized, focusWindow]);
  
  // Mouse move handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Handle dragging
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        
        let newX = dragRef.current.startWindowX + dx;
        let newY = dragRef.current.startWindowY + dy;
        
        // Constrain: top edge at menu bar, other edges at screen bounds
        // Windows can move behind the dock
        const areaWidth = window.innerWidth;
        const areaHeight = window.innerHeight - MENUBAR_HEIGHT;
        
        newX = Math.max(0, Math.min(newX, areaWidth - config.width));
        newY = Math.max(0, Math.min(newY, areaHeight - config.height));
        
        moveWindow(config.id, newX, newY);
      }
      
      // Handle resizing
      if (resizeRef.current) {
        const { handle, startX, startY, startBounds } = resizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        let newX = startBounds.x;
        let newY = startBounds.y;
        let newWidth = startBounds.width;
        let newHeight = startBounds.height;
        
        // Adjust based on handle
        if (handle.includes('e')) {
          newWidth = Math.max(config.minWidth, startBounds.width + dx);
        }
        if (handle.includes('w')) {
          const proposedWidth = startBounds.width - dx;
          if (proposedWidth >= config.minWidth) {
            newWidth = proposedWidth;
            newX = startBounds.x + dx;
          }
        }
        if (handle.includes('s')) {
          newHeight = Math.max(config.minHeight, startBounds.height + dy);
        }
        if (handle.includes('n')) {
          const proposedHeight = startBounds.height - dy;
          if (proposedHeight >= config.minHeight) {
            newHeight = proposedHeight;
            newY = startBounds.y + dy;
          }
        }
        
        // Enforce aspect ratio constraint on the content area
        if (config.aspectRatio && config.lockAspectRatio) {
          const chrome = config.chromeHeight ?? 0;
          const ratio = config.aspectRatio;
          const hasH = handle.includes('n') || handle.includes('s');
          const hasW = handle.includes('e') || handle.includes('w');
          
          if (hasW && !hasH) {
            // Horizontal edge only: derive height from width
            const contentH = newWidth / ratio;
            newHeight = Math.round(contentH + chrome);
          } else if (hasH && !hasW) {
            // Vertical edge only: derive width from height
            const contentH = newHeight - chrome;
            newWidth = Math.round(contentH * ratio);
          } else {
            // Corner handle: use the axis with the larger relative delta to drive
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            if (absDx >= absDy) {
              // Width drives
              const contentH = newWidth / ratio;
              newHeight = Math.round(contentH + chrome);
            } else {
              // Height drives
              const contentH = newHeight - chrome;
              newWidth = Math.round(contentH * ratio);
            }
          }
          
          // Re-clamp after aspect ratio adjustment
          newWidth = Math.max(config.minWidth, Math.min(newWidth, config.maxWidth ?? Infinity));
          newHeight = Math.max(config.minHeight, Math.min(newHeight, config.maxHeight ?? Infinity));
          
          // Adjust position for n/w handles so the opposite edge stays anchored
          if (handle.includes('w')) {
            newX = startBounds.x + startBounds.width - newWidth;
          }
          if (handle.includes('n')) {
            newY = startBounds.y + startBounds.height - newHeight;
          }
        }
        
        // Clamp to screen boundaries — prevent resizing outside the desktop area
        const areaWidth = window.innerWidth;
        const areaHeight = window.innerHeight - MENUBAR_HEIGHT;

        // Right / bottom edges
        if (newX + newWidth > areaWidth) {
          if (handle.includes('e')) newWidth = areaWidth - newX;
          else newX = areaWidth - newWidth; // west handle: anchor right edge
        }
        if (newY + newHeight > areaHeight) {
          if (handle.includes('s')) newHeight = areaHeight - newY;
          else newY = areaHeight - newHeight; // north handle: anchor bottom edge
        }
        // Left / top edges
        if (newX < 0) {
          if (handle.includes('w')) { newWidth += newX; newX = 0; }
          else newX = 0;
        }
        if (newY < 0) {
          if (handle.includes('n')) { newHeight += newY; newY = 0; }
          else newY = 0;
        }

        // Re-enforce minimums after boundary clamping
        newWidth = Math.max(config.minWidth, newWidth);
        newHeight = Math.max(config.minHeight, newHeight);

        setBounds(config.id, { x: newX, y: newY, width: newWidth, height: newHeight });
      }
    };
    
    const handleMouseUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [config.id, config.minWidth, config.minHeight, config.maxWidth, config.maxHeight, config.aspectRatio, config.chromeHeight, config.width, moveWindow, setBounds]);
  
  // Handle window close (animate out, then remove)
  const handleClose = useCallback(() => {
    play('close');
    setAnimVisible(false);
    setTimeout(() => closeWindow(config.id), 200);
  }, [config.id, closeWindow, play]);
  
  // Handle minimize
  const handleMinimize = useCallback(() => {
    play('minimize');
    minimizeWindow(config.id);
  }, [config.id, minimizeWindow, play]);
  
  // Handle maximize toggle (with bounds animation)
  const handleMaximize = useCallback(() => {
    play('maximize');
    setAnimateBounds(true);
    toggleMaximize(config.id);
    setTimeout(() => setAnimateBounds(false), 300);
  }, [config.id, toggleMaximize, play]);
  
  // Handle focus on click
  const handleClick = useCallback(() => {
    if (!isFocused) {
      play('click');
      focusWindow(config.id);
    }
  }, [config.id, isFocused, focusWindow, play]);
  
  if (!shouldRender) return null;
  
  const baseTransition = 'opacity 200ms ease-out, transform 200ms ease-out, box-shadow 200ms ease-out';
  const boundsTransition = 'left 300ms ease-in-out, top 300ms ease-in-out, width 300ms ease-in-out, height 300ms ease-in-out';
  
  return (
    <div
      ref={windowRef}
      className={cn(
        'absolute flex flex-col overflow-hidden rounded-xl backdrop-blur-xl',
        'bg-white/70 border border-black/10',
        'dark:bg-black/40 dark:border-white/15',
        isFocused
          ? 'shadow-[0_8px_24px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)]'
          : 'shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.25)]'
      )}
      style={{
        left: config.x,
        top: config.y,
        width: config.width,
        height: config.height,
        zIndex: config.zIndex,
        opacity: animVisible ? 1 : 0,
        transform: animVisible ? 'scale(1) translateY(0)' : 'scale(0.97) translateY(8px)',
        transition: animateBounds ? `${boundsTransition}, ${baseTransition}` : baseTransition,
      }}
      onMouseDown={handleClick}
    >
      <TitleBar
        title={config.title}
        icon={config.icon}
        isFocused={isFocused}
        state={config.state}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onClose={handleClose}
        onDoubleClick={handleMaximize}
        onMouseDown={handleDragStart}
      />
      
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
      
      <ResizeHandles
        onResizeStart={handleResizeStart}
        disabled={isMaximized}
      />
    </div>
  );
}
