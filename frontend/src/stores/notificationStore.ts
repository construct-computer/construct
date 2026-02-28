import { create } from 'zustand';

export interface Notification {
  id: string;
  title: string;
  body?: string;
  source?: string;
  variant?: 'info' | 'success' | 'error';
  timestamp: number;
  read: boolean;
}

let nextId = 0;

interface NotificationStore {
  /** All notifications (persisted in notification center). */
  notifications: Notification[];
  /** IDs currently visible as toast banners. */
  activeToasts: string[];
  /** Whether the notification center drawer is open. */
  drawerOpen: boolean;

  /** Add a notification to history and show a toast banner. */
  addNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>, toastDurationMs?: number) => string;
  /** Dismiss a toast banner (keeps notification in history). */
  dismissToast: (id: string) => void;
  /** Remove a single notification from history entirely. */
  removeNotification: (id: string) => void;
  /** Mark a single notification as read. */
  markRead: (id: string) => void;
  /** Mark all as read. */
  markAllRead: () => void;
  /** Clear all notifications from history. */
  clearAll: () => void;
  /** Toggle the notification center drawer. */
  toggleDrawer: () => void;
  /** Set drawer open state explicitly. */
  setDrawerOpen: (open: boolean) => void;

  /** Derived: unread count. */
  unreadCount: () => number;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  activeToasts: [],
  drawerOpen: false,

  addNotification: (n, toastDurationMs = 5000) => {
    const id = `notif-${nextId++}`;
    const notification: Notification = {
      ...n,
      id,
      timestamp: Date.now(),
      read: false,
    };
    set((s) => ({
      notifications: [notification, ...s.notifications],
      activeToasts: [id, ...s.activeToasts],
    }));
    if (toastDurationMs > 0) {
      setTimeout(() => {
        set((s) => ({ activeToasts: s.activeToasts.filter((t) => t !== id) }));
      }, toastDurationMs);
    }
    return id;
  },

  dismissToast: (id) => {
    set((s) => ({ activeToasts: s.activeToasts.filter((t) => t !== id) }));
  },

  removeNotification: (id) => {
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
      activeToasts: s.activeToasts.filter((t) => t !== id),
    }));
  },

  markRead: (id) => {
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    }));
  },

  markAllRead: () => {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    }));
  },

  clearAll: () => {
    set({ notifications: [], activeToasts: [] });
  },

  toggleDrawer: () => {
    const opening = !get().drawerOpen;
    set({ drawerOpen: opening });
    // Mark all as read when opening
    if (opening) {
      set((s) => ({
        notifications: s.notifications.map((n) => ({ ...n, read: true })),
      }));
    }
  },

  setDrawerOpen: (open) => {
    set({ drawerOpen: open });
    if (open) {
      set((s) => ({
        notifications: s.notifications.map((n) => ({ ...n, read: true })),
      }));
    }
  },

  unreadCount: () => get().notifications.filter((n) => !n.read).length,
}));
