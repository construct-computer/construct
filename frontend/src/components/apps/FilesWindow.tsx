import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder,
  File,
  FileText,
  FileCode,
  FileImage,
  FileArchive,
  FileEdit,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  ChevronRight,
  ArrowUp,
  RefreshCw,
  Home,
  HardDrive,
  Loader2,
  Link,
  Eye,
  EyeOff,
  Cloud,
} from 'lucide-react';
import type { WindowConfig } from '@/types';
import { useComputerStore } from '@/stores/agentStore';
import { useWindowStore } from '@/stores/windowStore';
import { useEditorStore } from '@/stores/editorStore';
import * as api from '@/services/api';
import type { FileEntry } from '@/services/api';

interface FilesWindowProps {
  config: WindowConfig;
}

const WORKSPACE_PATH = '/home/sandbox/workspace';
const HOME_PATH = '/home/sandbox';

function formatSize(bytes: number): string {
  if (bytes === 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFileIcon(entry: FileEntry) {
  if (entry.type === 'directory') return Folder;
  if (entry.type === 'symlink') return Link;

  const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) return FileImage;
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(ext)) return FileArchive;
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'c', 'cpp', 'h', 'java', 'rb', 'sh', 'bash', 'yaml', 'yml', 'toml', 'json', 'xml', 'html', 'css', 'scss'].includes(ext)) return FileCode;
  if (['txt', 'md', 'log', 'csv', 'env', 'cfg', 'ini', 'conf'].includes(ext)) return FileText;
  return File;
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'log', 'csv', 'tsv',
  'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'cfg', 'env',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'rs', 'go', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'swift',
  'sh', 'bash', 'zsh', 'fish',
  'html', 'htm', 'css', 'scss', 'less', 'svg',
  'sql', 'graphql', 'gql',
  'dockerfile', 'makefile', 'cmake',
  'gitignore', 'gitattributes', 'dockerignore', 'editorconfig', 'eslintrc',
  'prettierrc', 'babelrc',
  'lock', 'prisma',
]);

const TEXT_FILENAMES = new Set([
  'dockerfile', 'makefile', 'cmakelists.txt', 'gemfile', 'rakefile',
  'procfile', 'brewfile', 'vagrantfile', 'license', 'readme', 'changelog',
  'authors', 'contributors', 'todo', 'copying',
]);

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  const baseName = lower.split('/').pop() ?? lower;
  if (TEXT_FILENAMES.has(baseName)) return true;
  if (baseName.startsWith('.')) {
    const withoutDot = baseName.slice(1);
    if (TEXT_EXTENSIONS.has(withoutDot)) return true;
    return true;
  }
  const ext = baseName.split('.').pop() ?? '';
  return TEXT_EXTENSIONS.has(ext);
}

function joinPath(base: string, name: string): string {
  if (base === '/') return `/${name}`;
  return `${base}/${name}`;
}

// ─── Context menu types ────────────────────────────────────────────────────

type ContextMenuType =
  | { kind: 'background'; x: number; y: number }
  | { kind: 'item'; x: number; y: number; entry: FileEntry };

// ─── Context menu (rendered via portal) ────────────────────────────────────

function ContextMenu({
  menu,
  onClose,
  onEditFile,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
}: {
  menu: ContextMenuType;
  onClose: () => void;
  onEditFile: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const itemClass =
    'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[var(--color-accent)] hover:text-white transition-colors';
  const separatorClass = 'my-1 border-t border-[var(--color-border)]';

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[170px] py-1 bg-[var(--color-surface-raised)]/80 backdrop-blur-xl border border-[var(--color-border)] rounded-md shadow-lg"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.kind === 'background' ? (
        <>
          <button className={itemClass} onClick={onNewFile}>
            <FilePlus className="w-3.5 h-3.5" />
            New File
          </button>
          <button className={itemClass} onClick={onNewFolder}>
            <FolderPlus className="w-3.5 h-3.5" />
            New Folder
          </button>
        </>
      ) : (
        <>
          {menu.entry.type === 'file' && (
            <>
              <button className={itemClass} onClick={() => onEditFile(menu.entry)}>
                <FileEdit className="w-3.5 h-3.5" />
                Edit File
              </button>
              <div className={separatorClass} />
            </>
          )}
          <button className={itemClass} onClick={() => onRename(menu.entry)}>
            <Pencil className="w-3.5 h-3.5" />
            Rename
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-red-500 hover:text-white transition-colors"
            onClick={() => onDelete(menu.entry)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

// ─── Inline name input (for rename and new file/folder) ────────────────────

function InlineNameInput({
  defaultValue,
  onSubmit,
  onCancel,
}: {
  defaultValue: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Delay to ensure DOM is settled and no competing focus events
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      // Select name without extension for files
      const dotIdx = defaultValue.lastIndexOf('.');
      if (dotIdx > 0) {
        input.setSelectionRange(0, dotIdx);
      } else {
        input.select();
      }
    });
  }, [defaultValue]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== defaultValue) {
      onSubmit(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      className="bg-[#1a1a2e] border border-[var(--color-accent)] text-[var(--color-text)] text-xs px-1 py-0.5 rounded outline-none w-full min-w-[60px] shadow-sm"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={submit}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function FilesWindow({ config }: FilesWindowProps) {
  const instanceId = useComputerStore((s) => s.instanceId);
  const [currentPath, setCurrentPath] = useState(WORKSPACE_PATH);
  const [rawEntries, setRawEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showHidden, setShowHidden] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuType | null>(null);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<'file' | 'folder' | null>(null);

  const entries = useMemo(() => {
    return rawEntries
      .filter((e) => showHidden || !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.type !== b.type) {
          if (a.type === 'directory') return -1;
          if (b.type === 'directory') return 1;
        }
        return a.name.localeCompare(b.name);
      });
  }, [rawEntries, showHidden]);

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!instanceId) return;
      setLoading(true);
      setError(null);
      setSelectedName(null);
      setRenamingName(null);
      setCreatingType(null);

      const result = await api.listFiles(instanceId, path);

      if (result.success) {
        setRawEntries(result.data.entries);
        setCurrentPath(result.data.path);
      } else {
        setError(result.error);
      }
      setLoading(false);
    },
    [instanceId],
  );

  useEffect(() => {
    loadDirectory(currentPath);
    setHistory([currentPath]);
    setHistoryIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => loadDirectory(currentPath), [loadDirectory, currentPath]);

  const navigateTo = useCallback(
    (path: string) => {
      const newHistory = [...history.slice(0, historyIndex + 1), path];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setCurrentPath(path);
      loadDirectory(path);
    },
    [history, historyIndex, loadDirectory],
  );

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setCurrentPath(prev);
      loadDirectory(prev);
    }
  }, [history, historyIndex, loadDirectory]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setCurrentPath(next);
      loadDirectory(next);
    }
  }, [history, historyIndex, loadDirectory]);

  const goUp = useCallback(() => {
    if (currentPath === '/') return;
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parent);
  }, [currentPath, navigateTo]);

  const handleItemClick = useCallback(
    (entry: FileEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedName(entry.name);
    },
    [],
  );

  const ensureWindowOpen = useWindowStore((s) => s.ensureWindowOpen);
  const openFile = useEditorStore((s) => s.openFile);

  const handleItemDoubleClick = useCallback(
    (entry: FileEntry) => {
      if (renamingName) return;
      if (entry.type === 'directory' || entry.type === 'symlink') {
        navigateTo(joinPath(currentPath, entry.name));
        return;
      }
      if (entry.type === 'file' && isTextFile(entry.name)) {
        const fullPath = joinPath(currentPath, entry.name);
        openFile(fullPath);
        ensureWindowOpen('editor');
      }
    },
    [currentPath, navigateTo, openFile, ensureWindowOpen, renamingName],
  );

  // ─── Context menu handlers ──────────────────────────────────────────────

  const handleItemContextMenu = useCallback(
    (entry: FileEntry, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedName(entry.name);
      setContextMenu({ kind: 'item', x: e.clientX, y: e.clientY, entry });
    },
    [],
  );

  const handleBackgroundContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Only if clicking on background, not on an item
      if ((e.target as HTMLElement).closest('[data-file-entry]')) return;
      e.preventDefault();
      setContextMenu({ kind: 'background', x: e.clientX, y: e.clientY });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleEditFile = useCallback(
    (entry: FileEntry) => {
      const fullPath = joinPath(currentPath, entry.name);
      openFile(fullPath);
      ensureWindowOpen('editor');
      setContextMenu(null);
    },
    [currentPath, openFile, ensureWindowOpen],
  );

  const handleStartRename = useCallback(
    (entry: FileEntry) => {
      setRenamingName(entry.name);
      setSelectedName(entry.name);
      setContextMenu(null);
    },
    [],
  );

  const handleRenameSubmit = useCallback(
    async (newName: string) => {
      if (!instanceId || !renamingName) return;
      const oldPath = joinPath(currentPath, renamingName);
      const newPath = joinPath(currentPath, newName);
      const result = await api.renameItem(instanceId, oldPath, newPath);
      setRenamingName(null);
      if (result.success) {
        setSelectedName(newName);
        refresh();
      }
    },
    [instanceId, currentPath, renamingName, refresh],
  );

  const handleDelete = useCallback(
    async (entry: FileEntry) => {
      if (!instanceId) return;
      setContextMenu(null);
      const fullPath = joinPath(currentPath, entry.name);
      const result = await api.deleteItem(instanceId, fullPath);
      if (result.success) {
        refresh();
      }
    },
    [instanceId, currentPath, refresh],
  );

  const handleNewFile = useCallback(() => {
    setContextMenu(null);
    setCreatingType('file');
  }, []);

  const handleNewFolder = useCallback(() => {
    setContextMenu(null);
    setCreatingType('folder');
  }, []);

  const handleCreateSubmit = useCallback(
    async (name: string) => {
      if (!instanceId || !creatingType) return;
      const fullPath = joinPath(currentPath, name);
      const result =
        creatingType === 'folder'
          ? await api.createDirectory(instanceId, fullPath)
          : await api.createFile(instanceId, fullPath);
      setCreatingType(null);
      if (result.success) {
        setSelectedName(name);
        refresh();
      }
    },
    [instanceId, currentPath, creatingType, refresh],
  );

  // ─── Keyboard navigation ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (renamingName || creatingType) return;
      if (!entries.length) return;

      if (e.key === 'Enter' && selectedName) {
        const entry = entries.find((en) => en.name === selectedName);
        if (entry && (entry.type === 'directory' || entry.type === 'symlink')) {
          navigateTo(joinPath(currentPath, entry.name));
        }
        return;
      }
      if (e.key === 'Backspace') {
        goUp();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = entries.findIndex((en) => en.name === selectedName);
        let next: number;
        if (e.key === 'ArrowDown') {
          next = idx < entries.length - 1 ? idx + 1 : 0;
        } else {
          next = idx > 0 ? idx - 1 : entries.length - 1;
        }
        setSelectedName(entries[next].name);
      }
      if (e.key === 'F2' && selectedName) {
        const entry = entries.find((en) => en.name === selectedName);
        if (entry) setRenamingName(entry.name);
      }
      if (e.key === 'Delete' && selectedName) {
        const entry = entries.find((en) => en.name === selectedName);
        if (entry) handleDelete(entry);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entries, selectedName, currentPath, navigateTo, goUp, renamingName, creatingType, handleDelete]);

  const pathParts = currentPath.split('/').filter(Boolean);

  const sidebarLocations = [
    { label: 'Workspace', path: WORKSPACE_PATH, icon: Folder },
    { label: 'Home', path: HOME_PATH, icon: Home },
    { label: 'Root', path: '/', icon: HardDrive },
  ];

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] text-sm select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <button
          onClick={goBack}
          className="p-1 rounded hover:bg-[var(--color-border)] disabled:opacity-30"
          disabled={historyIndex <= 0}
          title="Back"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
        </button>
        <button
          onClick={goForward}
          className="p-1 rounded hover:bg-[var(--color-border)] disabled:opacity-30"
          disabled={historyIndex >= history.length - 1}
          title="Forward"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={goUp}
          className="p-1 rounded hover:bg-[var(--color-border)] disabled:opacity-30"
          disabled={currentPath === '/'}
          title="Go up"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button
          onClick={refresh}
          className="p-1 rounded hover:bg-[var(--color-border)]"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Breadcrumb path bar */}
        <div className="flex-1 flex items-center gap-0.5 ml-2 px-2 py-1 bg-[var(--color-surface)] rounded border border-[var(--color-border)] overflow-x-auto text-xs">
          <span
            className="cursor-pointer hover:text-[var(--color-accent)] flex-shrink-0"
            onClick={() => navigateTo('/')}
          >
            /
          </span>
          {pathParts.map((part, i) => {
            const fullPath = '/' + pathParts.slice(0, i + 1).join('/');
            return (
              <span key={fullPath} className="flex items-center gap-0.5 whitespace-nowrap flex-shrink-0">
                <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
                <span
                  className="cursor-pointer hover:text-[var(--color-accent)]"
                  onClick={() => navigateTo(fullPath)}
                >
                  {part}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-36 border-r border-[var(--color-border)] p-2 bg-[var(--color-surface-raised)] flex-shrink-0 overflow-y-auto">
          <div className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
            Locations
          </div>
          <div className="space-y-0.5">
            {sidebarLocations.map(({ label, path, icon: Icon }) => (
              <div
                key={path}
                className={`flex items-center gap-2 px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
                  currentPath === path
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'hover:bg-[var(--color-accent-muted)]'
                }`}
                onClick={() => navigateTo(path)}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{label}</span>
              </div>
            ))}
          </div>
          <div className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mt-4 mb-2">
            Cloud
          </div>
          <div className="space-y-0.5">
            <div
              className="flex items-center gap-2 px-2 py-1 text-xs rounded cursor-default text-[var(--color-text-muted)] opacity-50"
              title="Coming soon"
            >
              <Cloud className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">Google Drive</span>
            </div>
          </div>
        </div>

        {/* Main file list */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Column headers */}
          <div className="flex items-center px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[11px] text-[var(--color-text-muted)] font-medium">
            <div className="flex-1 min-w-0">Name</div>
            <div className="w-20 text-right flex-shrink-0">Size</div>
            <div className="w-32 text-right flex-shrink-0">Modified</div>
          </div>

          {/* File entries */}
          <div
            className="flex-1 overflow-y-auto"
            onClick={() => {
              setSelectedName(null);
              setContextMenu(null);
            }}
            onContextMenu={handleBackgroundContextMenu}
          >
            {loading ? (
              <div className="flex items-center justify-center h-32 text-[var(--color-text-muted)]">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-xs">Loading...</span>
              </div>
            ) : error ? (
              <div className="p-4 text-center">
                <p className="text-xs text-red-400 mb-2">{error}</p>
                <button
                  className="text-xs text-[var(--color-accent)] hover:underline"
                  onClick={refresh}
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                {entries.length === 0 && !creatingType && (
                  <div className="p-8 text-center text-[var(--color-text-muted)] text-xs">
                    This folder is empty
                  </div>
                )}
                {entries.map((entry) => {
                  const isSelected = selectedName === entry.name;
                  const isRenaming = renamingName === entry.name;
                  const Icon = getFileIcon(entry);

                  return (
                    <div
                      key={entry.name}
                      data-file-entry
                      className={`flex items-center px-3 py-[3px] cursor-default ${
                        isSelected
                          ? 'bg-[var(--color-accent)] text-white'
                          : 'hover:bg-[var(--color-accent-muted)]'
                      }`}
                      onClick={(e) => handleItemClick(entry, e)}
                      onDoubleClick={() => handleItemDoubleClick(entry)}
                      onContextMenu={(e) => handleItemContextMenu(entry, e)}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Icon
                          className={`w-4 h-4 flex-shrink-0 ${
                            isSelected
                              ? 'text-white/80'
                              : entry.type === 'directory'
                                ? 'text-[var(--color-accent)]'
                                : 'text-[var(--color-text-muted)]'
                          }`}
                        />
                        {isRenaming ? (
                          <InlineNameInput
                            defaultValue={entry.name}
                            onSubmit={handleRenameSubmit}
                            onCancel={() => setRenamingName(null)}
                          />
                        ) : (
                          <span className="truncate text-xs">{entry.name}</span>
                        )}
                      </div>
                      <div
                        className={`w-20 text-right text-[11px] flex-shrink-0 ${
                          isSelected ? 'text-white/70' : 'text-[var(--color-text-muted)]'
                        }`}
                      >
                        {entry.type === 'file' ? formatSize(entry.size) : '--'}
                      </div>
                      <div
                        className={`w-32 text-right text-[11px] flex-shrink-0 ${
                          isSelected ? 'text-white/70' : 'text-[var(--color-text-muted)]'
                        }`}
                      >
                        {formatDate(entry.modified)}
                      </div>
                    </div>
                  );
                })}

                {/* Inline new file/folder input */}
                {creatingType && (
                  <div className="flex items-center px-3 py-[3px] bg-[var(--color-accent-muted)]">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {creatingType === 'folder' ? (
                        <Folder className="w-4 h-4 flex-shrink-0 text-[var(--color-accent)]" />
                      ) : (
                        <File className="w-4 h-4 flex-shrink-0 text-[var(--color-text-muted)]" />
                      )}
                      <InlineNameInput
                        defaultValue={creatingType === 'folder' ? 'new-folder' : 'new-file.txt'}
                        onSubmit={handleCreateSubmit}
                        onCancel={() => setCreatingType(null)}
                      />
                    </div>
                    <div className="w-20 flex-shrink-0" />
                    <div className="w-32 flex-shrink-0" />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Context menu (portal) */}
          {contextMenu && (
            <ContextMenu
              menu={contextMenu}
              onClose={closeContextMenu}
              onEditFile={handleEditFile}
              onRename={handleStartRename}
              onDelete={handleDelete}
              onNewFile={handleNewFile}
              onNewFolder={handleNewFolder}
            />
          )}

          {/* Status bar */}
          <div className="flex items-center px-3 py-1 border-t border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[11px] text-[var(--color-text-muted)]">
            <span>
              {entries.length} item{entries.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setShowHidden((v) => !v)}
              className="flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded hover:bg-[var(--color-border)] transition-colors"
              title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
            >
              {showHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              <span>{showHidden ? 'Hide dotfiles' : 'Show dotfiles'}</span>
            </button>
            {selectedName && <span className="ml-auto">{selectedName}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
