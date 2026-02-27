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
  closeTab: (filePath: string) => void;
  setActiveTab: (filePath: string) => void;
  updateContent: (filePath: string, content: string) => void;
  saveActiveFile: () => Promise<void>;
  saveFile: (filePath: string) => Promise<void>;
  getTab: (filePath: string) => EditorTab | undefined;
  getActiveTab: () => EditorTab | undefined;
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
