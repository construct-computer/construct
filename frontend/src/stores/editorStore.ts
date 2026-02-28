import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useComputerStore } from './agentStore';
import { useWindowStore } from './windowStore';
import * as api from '@/services/api';

export interface EditorTab {
  filePath: string;
  fileName: string;
  content: string;
  savedContent: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface EditorStore {
  tabs: EditorTab[];
  activeTabPath: string | null;

  openFile: (filePath: string) => void;
  /** Re-fetch a file's content from the container. Always overwrites local content. */
  refreshFile: (filePath: string) => void;
  /** Open a file if not already open, or refresh it if already open (for external edits). */
  openOrRefreshFile: (filePath: string) => void;
  closeTab: (filePath: string) => void;
  setActiveTab: (filePath: string) => void;
  updateContent: (filePath: string, content: string) => void;
  saveActiveFile: () => Promise<void>;
  saveFile: (filePath: string) => Promise<void>;
  getTab: (filePath: string) => EditorTab | undefined;
  getActiveTab: () => EditorTab | undefined;
  clearAllTabs: () => void;
}

function extractFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

export const useEditorStore = create<EditorStore>()(
  subscribeWithSelector((set, get) => ({
    tabs: [],
    activeTabPath: null,

    openFile: (filePath: string) => {
      const { tabs } = get();
      const existing = tabs.find((t) => t.filePath === filePath);

      if (existing) {
        // Already open — just activate
        set({ activeTabPath: filePath });
        return;
      }

      // Add new tab in loading state
      const newTab: EditorTab = {
        filePath,
        fileName: extractFileName(filePath),
        content: '',
        savedContent: '',
        loading: true,
        saving: false,
        error: null,
      };

      set({
        tabs: [...tabs, newTab],
        activeTabPath: filePath,
      });

      // Fetch file content
      const instanceId = useComputerStore.getState().instanceId;
      if (!instanceId) {
        set({
          tabs: get().tabs.map((t) =>
            t.filePath === filePath
              ? { ...t, loading: false, error: 'No instance connected' }
              : t,
          ),
        });
        return;
      }

      api.readFile(instanceId, filePath).then((result) => {
        const currentTabs = get().tabs;
        // Tab might have been closed while loading
        if (!currentTabs.find((t) => t.filePath === filePath)) return;

        if (result.success) {
          set({
            tabs: currentTabs.map((t) =>
              t.filePath === filePath
                ? {
                    ...t,
                    content: result.data.content,
                    savedContent: result.data.content,
                    loading: false,
                    error: null,
                  }
                : t,
            ),
          });
        } else {
          set({
            tabs: currentTabs.map((t) =>
              t.filePath === filePath
                ? { ...t, loading: false, error: result.error }
                : t,
            ),
          });
        }
      });
    },

    refreshFile: (filePath: string) => {
      const instanceId = useComputerStore.getState().instanceId;
      if (!instanceId) return;

      const tab = get().tabs.find((t) => t.filePath === filePath);
      if (!tab) return;

      api.readFile(instanceId, filePath).then((result) => {
        const currentTabs = get().tabs;
        if (!currentTabs.find((t) => t.filePath === filePath)) return;

        if (result.success) {
          // Only update if the server content actually changed
          const existing = currentTabs.find((t) => t.filePath === filePath);
          if (existing && existing.savedContent === result.data.content) return;

          set({
            tabs: currentTabs.map((t) =>
              t.filePath === filePath
                ? { ...t, content: result.data.content, savedContent: result.data.content }
                : t,
            ),
          });
        }
      });
    },

    openOrRefreshFile: (filePath: string) => {
      const existing = get().tabs.find((t) => t.filePath === filePath);
      if (existing) {
        set({ activeTabPath: filePath });
        get().refreshFile(filePath);
      } else {
        get().openFile(filePath);
      }
    },

    closeTab: (filePath: string) => {
      const { tabs, activeTabPath } = get();
      const idx = tabs.findIndex((t) => t.filePath === filePath);
      if (idx === -1) return;

      const newTabs = tabs.filter((t) => t.filePath !== filePath);

      let newActive = activeTabPath;
      if (activeTabPath === filePath) {
        if (newTabs.length === 0) {
          newActive = null;
        } else if (idx < newTabs.length) {
          newActive = newTabs[idx].filePath;
        } else {
          newActive = newTabs[newTabs.length - 1].filePath;
        }
      }

      set({ tabs: newTabs, activeTabPath: newActive });
    },

    setActiveTab: (filePath: string) => {
      set({ activeTabPath: filePath });
    },

    updateContent: (filePath: string, content: string) => {
      set({
        tabs: get().tabs.map((t) =>
          t.filePath === filePath ? { ...t, content } : t,
        ),
      });
    },

    saveActiveFile: async () => {
      const { activeTabPath } = get();
      if (activeTabPath) {
        await get().saveFile(activeTabPath);
      }
    },

    saveFile: async (filePath: string) => {
      const tab = get().tabs.find((t) => t.filePath === filePath);
      if (!tab || tab.content === tab.savedContent) return;

      const instanceId = useComputerStore.getState().instanceId;
      if (!instanceId) return;

      set({
        tabs: get().tabs.map((t) =>
          t.filePath === filePath ? { ...t, saving: true } : t,
        ),
      });

      const result = await api.writeFile(instanceId, filePath, tab.content);

      set({
        tabs: get().tabs.map((t) =>
          t.filePath === filePath
            ? {
                ...t,
                saving: false,
                savedContent: result.success ? tab.content : t.savedContent,
              }
            : t,
        ),
      });
    },

    getTab: (filePath: string) => {
      return get().tabs.find((t) => t.filePath === filePath);
    },

    getActiveTab: () => {
      const { tabs, activeTabPath } = get();
      return tabs.find((t) => t.filePath === activeTabPath);
    },

    clearAllTabs: () => {
      set({ tabs: [], activeTabPath: null });
    },
  })),
);

// When the last editor window is closed, clear all tabs
useWindowStore.subscribe(
  (s) => s.windows,
  (windows) => {
    const hasEditor = windows.some((w) => w.type === 'editor');
    if (!hasEditor && useEditorStore.getState().tabs.length > 0) {
      useEditorStore.getState().clearAllTabs();
    }
  },
);

// ── Live file polling ──────────────────────────────────────────────────────
// Poll the active tab every 3 seconds for external changes.
// Only updates if the tab is clean (no unsaved local edits) to avoid
// overwriting user work-in-progress. Agent-initiated refreshes (via
// openOrRefreshFile) always overwrite, regardless of dirty state.

let pollInterval: ReturnType<typeof setInterval> | null = null;

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(() => {
    const { tabs, activeTabPath } = useEditorStore.getState();
    if (!activeTabPath) return;
    const tab = tabs.find((t) => t.filePath === activeTabPath);
    if (!tab || tab.loading || tab.saving) return;
    // Only auto-refresh clean tabs to avoid overwriting user edits
    if (tab.content !== tab.savedContent) return;
    useEditorStore.getState().refreshFile(activeTabPath);
  }, 3000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// Start/stop polling based on whether tabs are open
useEditorStore.subscribe(
  (s) => s.tabs.length,
  (count) => {
    if (count > 0) startPolling();
    else stopPolling();
  },
);
