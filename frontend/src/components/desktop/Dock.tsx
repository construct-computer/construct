import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useWindowStore } from '@/stores/windowStore';
import { useComputerStore } from '@/stores/agentStore';
import { useSound } from '@/hooks/useSound';
import { Z_INDEX } from '@/lib/constants';
import type { WindowType } from '@/types';

// App icons
import iconChat from '@/icons/chat.png';
import iconTerminal from '@/icons/terminal.png';
import iconBrowser from '@/icons/browser.png';
import iconFiles from '@/icons/files.png';
import iconComputer from '@/assets/computer.png';

interface DockItemConfig {
  id: string;
  label: string;
  icon: string;
  windowType: WindowType;
}

const dockItems: DockItemConfig[] = [
  { id: 'computer', label: 'My Computer', icon: iconComputer, windowType: 'settings' },
  { id: 'chat', label: 'Construct Agent', icon: iconChat, windowType: 'chat' },
  { id: 'browser', label: 'Browser', icon: iconBrowser, windowType: 'browser' },
  { id: 'terminal', label: 'Terminal', icon: iconTerminal, windowType: 'terminal' },
  { id: 'files', label: 'Files', icon: iconFiles, windowType: 'files' },
];

// Gaussian magnification constants
const MAX_SCALE = 1.6;
const SIGMA = 60;
const PUSH_FACTOR = 22;

function DockItem({
  item,
  mouseX,
  isActive,
  isAgentActive,
  onClick,
}: {
  item: DockItemConfig;
  mouseX: number | null;
  isActive: boolean;
  isAgentActive: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [bouncing, setBouncing] = useState(false);

  let scale = 1;
  let translateX = 0;

  if (mouseX !== null && ref.current) {
    const rect = ref.current.getBoundingClientRect();
    const iconCenterX = rect.left + rect.width / 2;
    const distance = Math.abs(mouseX - iconCenterX);
    const signedDistance = iconCenterX - mouseX;

    scale = 1 + (MAX_SCALE - 1) * Math.exp(-(distance * distance) / (2 * SIGMA * SIGMA));

    const normalized = signedDistance / (SIGMA * 1.2);
    translateX = Math.abs(normalized) < 0.15 ? 0 : normalized * (scale - 1) * PUSH_FACTOR;
  }

  const lift = (scale - 1) * 18;
  const bounceOffset = bouncing ? 22 : 0;

  return (
    <div
      ref={ref}
      className="relative group flex flex-col items-center cursor-pointer"
      onClick={() => {
        if (bouncing) return;
        setBouncing(true);
        setTimeout(() => setBouncing(false), 300);
        onClick();
      }}
    >
      {/* Tooltip */}
      <div
        className="pointer-events-none absolute -top-12
                   opacity-0 scale-95
                   group-hover:opacity-100 group-hover:scale-100
                   transition-all duration-200
                   flex flex-col items-center z-50"
      >
        <div className="px-3 py-1 text-xs text-white rounded-md
                        bg-black/80 backdrop-blur-md whitespace-nowrap">
          {item.label}
        </div>
        <div className="w-2 h-2 bg-black/80 rotate-45 -mt-1" />
      </div>

      {/* Icon */}
      <div
        className="relative w-18 h-18 flex items-center justify-center
                   transition-transform duration-300
                   ease-[cubic-bezier(0.34,1.56,0.64,1)]
                   will-change-transform"
        style={{
          transform: `translateX(${translateX}px) translateY(-${lift + bounceOffset}px) scale(${scale})`,
        }}
      >
        <img
          src={item.icon}
          alt={item.label}
          className="w-14 h-14"
          draggable={false}
        />
        {/* Agent activity badge */}
        {isAgentActive && (
          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full
                          bg-amber-400 animate-pulse
                          shadow-[0_0_6px_rgba(251,191,36,0.6)]" />
        )}
      </div>

      {/* Active indicator dot */}
      <div
        className={cn(
          'w-1 h-1 rounded-full transition-opacity duration-200',
          isActive ? 'opacity-100 bg-black/40 dark:bg-white/50' : 'opacity-0'
        )}
      />
    </div>
  );
}

export function Dock() {
  const dockRef = useRef<HTMLDivElement>(null);
  const [mouseX, setMouseX] = useState<number | null>(null);
  const { play } = useSound();
  const { windows, focusedWindowId, openWindow, focusWindow, minimizeWindow } = useWindowStore();
  const agentActivity = useComputerStore((s) => s.agentActivity);

  const handleClick = (item: DockItemConfig) => {
    play('click');

    const openWindowsOfType = windows.filter((w) => w.type === item.windowType);

    if (openWindowsOfType.length === 0) {
      openWindow(item.windowType);
    } else if (openWindowsOfType.length === 1) {
      const win = openWindowsOfType[0];
      if (win.id === focusedWindowId && win.state !== 'minimized') {
        minimizeWindow(win.id);
      } else {
        focusWindow(win.id);
      }
    } else {
      const currentIdx = openWindowsOfType.findIndex((w) => w.id === focusedWindowId);
      const nextIdx = (currentIdx + 1) % openWindowsOfType.length;
      focusWindow(openWindowsOfType[nextIdx].id);
    }
  };

  const isActive = (type: WindowType) => windows.some((w) => w.type === type);

  return (
    <div
      className="absolute bottom-0 left-1/2 -translate-x-1/2"
      style={{ zIndex: Z_INDEX.taskbar }}
    >
      <div className="relative">
        {/* Glass shelf — 3D perspective trapezoid, halfway up icons */}
        <div
          className="absolute bottom-0 -inset-x-5 h-[46px]
                     bg-gradient-to-b from-white/15 to-white/40
                     dark:from-white/3 dark:to-white/10
                     backdrop-blur-2xl"
          style={{ clipPath: 'polygon(3% 0%, 97% 0%, 100% 100%, 0% 100%)' }}
        />
        {/* Shelf top edge highlight */}
        <div
          className="absolute -inset-x-5 h-px bg-white/40 dark:bg-white/15"
          style={{ bottom: 45, clipPath: 'polygon(3% 0%, 97% 0%, 97% 100%, 3% 100%)' }}
        />

        {/* Icons row — sitting on top of the shelf */}
        <div
          ref={dockRef}
          className="relative flex items-end gap-1 px-5 pb-[8px]"
          onMouseMove={(e) => setMouseX(e.clientX)}
          onMouseLeave={() => setMouseX(null)}
        >
          {dockItems.map((item) => (
            <DockItem
              key={item.id}
              item={item}
              mouseX={mouseX}
              isActive={isActive(item.windowType)}
              isAgentActive={agentActivity.has(item.windowType)}
              onClick={() => handleClick(item)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
