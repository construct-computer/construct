import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertCircle, Info, Trash2 } from 'lucide-react';
import { useNotificationStore, type Notification } from '@/stores/notificationStore';
import { MENUBAR_HEIGHT, Z_INDEX } from '@/lib/constants';

// ─── Time helpers ──────────────────────────────────────────────────────────

function formatTimeShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

type GroupKey = 'today' | 'yesterday' | 'earlier';

function getGroupKey(ts: number): GroupKey {
  const now = new Date();
  const date = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  return 'earlier';
}

const GROUP_LABELS: Record<GroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
};

function groupNotifications(notifications: Notification[]): [GroupKey, Notification[]][] {
  const groups = new Map<GroupKey, Notification[]>();
  for (const n of notifications) {
    const key = getGroupKey(n.timestamp);
    const list = groups.get(key) || [];
    list.push(n);
    groups.set(key, list);
  }
  // Return in fixed order
  const result: [GroupKey, Notification[]][] = [];
  for (const key of ['today', 'yesterday', 'earlier'] as GroupKey[]) {
    const list = groups.get(key);
    if (list && list.length > 0) result.push([key, list]);
  }
  return result;
}

// ─── Notification card ─────────────────────────────────────────────────────

function NotificationCard({ n, onRemove }: { n: Notification; onRemove: () => void }) {
  const Icon =
    n.variant === 'success' ? CheckCircle2
      : n.variant === 'error' ? AlertCircle
        : Info;

  const iconColor =
    n.variant === 'success' ? 'text-green-400'
      : n.variant === 'error' ? 'text-red-400'
        : 'text-[var(--color-accent)]';

  return (
    <div className="group relative bg-white/50 dark:bg-white/5 backdrop-blur-sm border border-black/5 dark:border-white/8 rounded-xl px-3.5 py-3 transition-colors hover:bg-white/70 dark:hover:bg-white/8">
      {/* Remove button (shows on hover) */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-2 right-2 p-0.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity"
      >
        <X className="w-3 h-3 text-black/40 dark:text-white/40" />
      </button>

      <div className="flex items-start gap-2.5">
        {/* Icon */}
        <div className="mt-0.5 flex-shrink-0">
          <Icon className={`w-4.5 h-4.5 ${iconColor}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2">
            {n.source && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/35">
                {n.source}
              </span>
            )}
            <span className="text-[10px] text-black/25 dark:text-white/25 ml-auto flex-shrink-0">
              {formatTimeShort(n.timestamp)}
            </span>
          </div>
          <p className="text-[13px] font-medium text-black/80 dark:text-white/85 leading-snug mt-0.5">
            {n.title}
          </p>
          {n.body && (
            <p className="text-[12px] text-black/45 dark:text-white/45 leading-snug mt-0.5">
              {n.body}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Notification Center drawer ────────────────────────────────────────────

const DRAWER_WIDTH = 360;

export function NotificationCenter() {
  const drawerOpen = useNotificationStore((s) => s.drawerOpen);
  const setDrawerOpen = useNotificationStore((s) => s.setDrawerOpen);
  const notifications = useNotificationStore((s) => s.notifications);
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drawerOpen, setDrawerOpen]);

  // Close on outside click
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        // Don't close if clicking the menu bar toggle button
        const toggle = document.getElementById('notification-center-toggle');
        if (toggle && toggle.contains(e.target as Node)) return;
        setDrawerOpen(false);
      }
    };
    // Delay to avoid the opening click from immediately closing
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [drawerOpen, setDrawerOpen]);

  const grouped = groupNotifications(notifications);

  return createPortal(
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/12 transition-opacity duration-300 ease-out"
        style={{
          top: MENUBAR_HEIGHT,
          zIndex: Z_INDEX.notification - 1,
          opacity: drawerOpen ? 1 : 0,
          pointerEvents: drawerOpen ? 'auto' : 'none',
        }}
        onClick={() => setDrawerOpen(false)}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className="fixed bottom-0 flex flex-col
                   bg-white/60 dark:bg-[#1a1a28]/70 backdrop-blur-2xl saturate-150
                   border-l border-black/8 dark:border-white/8
                   shadow-2xl shadow-black/15 dark:shadow-black/40
                   transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          top: MENUBAR_HEIGHT,
          right: 0,
          width: DRAWER_WIDTH,
          zIndex: Z_INDEX.notification,
          transform: drawerOpen ? 'translateX(0)' : `translateX(${DRAWER_WIDTH}px)`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h2 className="text-base font-semibold text-black/80 dark:text-white/85">
            Notifications
          </h2>
          {notifications.length > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-black/40 dark:text-white/40 hover:bg-black/5 dark:hover:bg-white/8 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear All
            </button>
          )}
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center mb-3">
                <Info className="w-5 h-5 text-black/20 dark:text-white/20" />
              </div>
              <p className="text-sm text-black/35 dark:text-white/35">
                No notifications
              </p>
            </div>
          ) : (
            grouped.map(([key, items]) => (
              <div key={key} className="mt-3 first:mt-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/30 px-1 mb-2">
                  {GROUP_LABELS[key]}
                </h3>
                <div className="space-y-2">
                  {items.map((n) => (
                    <NotificationCard
                      key={n.id}
                      n={n}
                      onRemove={() => removeNotification(n.id)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
