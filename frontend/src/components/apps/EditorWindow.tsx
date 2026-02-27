import { useEffect, useCallback, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Loader2, AlertCircle, X } from 'lucide-react';
import type { WindowConfig } from '@/types';
import { useEditorStore } from '@/stores/editorStore';
import type { EditorTab } from '@/stores/editorStore';

interface EditorWindowProps {
  config: WindowConfig;
}

// Maps file extensions to Monaco language IDs
const MONACO_LANG_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  txt: 'plaintext',
  log: 'plaintext',
  csv: 'plaintext',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  makefile: 'plaintext',
  env: 'ini',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  svg: 'xml',
  prisma: 'plaintext',
  lock: 'plaintext',
  gitignore: 'plaintext',
  dockerignore: 'plaintext',
  editorconfig: 'ini',
};

const LANGUAGE_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  go: 'Go',
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  shell: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  ini: 'INI',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  markdown: 'Markdown',
  plaintext: 'Plain Text',
  sql: 'SQL',
  graphql: 'GraphQL',
  dockerfile: 'Dockerfile',
};

function getMonacoLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  const baseName = lower.split('/').pop() ?? lower;
  if (baseName === 'dockerfile') return 'dockerfile';
  if (baseName === 'makefile' || baseName === 'cmakelists.txt') return 'plaintext';
  if (baseName.startsWith('.')) {
    const withoutDot = baseName.slice(1);
    if (MONACO_LANG_MAP[withoutDot]) return MONACO_LANG_MAP[withoutDot];
  }
  const ext = baseName.split('.').pop() ?? '';
  return MONACO_LANG_MAP[ext] || 'plaintext';
}

// ─── Tab bar ────────────────────────────────────────────────────────────────

function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
}: {
  tab: EditorTab;
  isActive: boolean;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  const isDirty = tab.content !== tab.savedContent;

  return (
    <div
      className={`group flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-xs border-r border-[#333] cursor-pointer shrink-0 ${
        isActive
          ? 'bg-[#1e1e1e] text-[#fff]'
          : 'bg-[#2d2d2d] text-[#999] hover:text-[#ccc]'
      }`}
      onClick={onActivate}
      onMouseDown={(e) => {
        // Middle-click to close
        if (e.button === 1) {
          e.preventDefault();
          onClose(e);
        }
      }}
    >
      <span className="truncate max-w-[120px]">{tab.fileName}</span>
      {/* Fixed-size slot: dirty dot and close button stacked in the same space */}
      <div className="relative w-4 h-4 shrink-0 flex items-center justify-center">
        {isDirty && (
          <span className="absolute inset-0 flex items-center justify-center group-hover:invisible">
            <span className="w-2 h-2 rounded-full bg-[#ccc]" />
          </span>
        )}
        <button
          className={`absolute inset-0 flex items-center justify-center rounded hover:bg-[#555] ${
            isDirty ? 'invisible group-hover:visible' : 'invisible group-hover:visible'
          }`}
          onClick={onClose}
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function EditorWindow({ config: _config }: EditorWindowProps) {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const updateContent = useEditorStore((s) => s.updateContent);
  const saveActiveFile = useEditorStore((s) => s.saveActiveFile);

  const activeTab = tabs.find((t) => t.filePath === activeTabPath) ?? null;
  const monacoLang = activeTab ? getMonacoLanguage(activeTab.filePath) : 'plaintext';
  const languageLabel = LANGUAGE_LABELS[monacoLang] || monacoLang;

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const saveRef = useRef(saveActiveFile);
  saveRef.current = saveActiveFile;

  // Monaco mount: register Ctrl+S keybinding
  const handleEditorMount: OnMount = useCallback((_editorInstance, monaco) => {
    editorRef.current = _editorInstance;

    _editorInstance.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        saveRef.current();
      },
    });

    _editorInstance.focus();
  }, []);

  // Focus editor when active tab changes
  useEffect(() => {
    if (editorRef.current && activeTab && !activeTab.loading) {
      // Small delay to let Monaco update its model
      requestAnimationFrame(() => editorRef.current?.focus());
    }
  }, [activeTabPath, activeTab?.loading]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (activeTabPath) {
        updateContent(activeTabPath, value ?? '');
      }
    },
    [activeTabPath, updateContent],
  );

  const handleCloseTab = useCallback(
    (filePath: string, e: React.MouseEvent) => {
      e.stopPropagation();
      closeTab(filePath);
    },
    [closeTab],
  );

  // ─── No tabs open ──────────────────────────────────────────────────────

  if (tabs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-[#1e1e1e] text-[#666] text-sm">
        Open a file from the Files app
      </div>
    );
  }

  // ─── Active tab states ─────────────────────────────────────────────────

  let editorContent: React.ReactNode;

  if (!activeTab) {
    editorContent = (
      <div className="flex items-center justify-center h-full text-[#666] text-sm">
        Select a tab
      </div>
    );
  } else if (activeTab.loading) {
    editorContent = (
      <div className="flex items-center justify-center h-full text-[#888]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-xs">Loading {activeTab.fileName}...</span>
      </div>
    );
  } else if (activeTab.error) {
    editorContent = (
      <div className="flex flex-col items-center justify-center h-full text-sm gap-2">
        <AlertCircle className="w-6 h-6 text-red-400" />
        <p className="text-red-400 text-xs">{activeTab.error}</p>
      </div>
    );
  } else {
    editorContent = (
      <Editor
        height="100%"
        path={activeTab.filePath}
        language={monacoLang}
        value={activeTab.content}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
        theme="vs-dark"
        loading={
          <div className="flex items-center justify-center h-full text-[#888]">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-xs">Loading editor...</span>
          </div>
        }
        options={{
          fontSize: 13,
          fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
          lineNumbers: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          tabSize: 2,
          insertSpaces: true,
          automaticLayout: true,
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          smoothScrolling: true,
          cursorSmoothCaretAnimation: 'on',
          padding: { top: 4 },
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
        }}
      />
    );
  }

  const isDirty = activeTab ? activeTab.content !== activeTab.savedContent : false;

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] select-none">
      {/* Tab bar */}
      <div className="flex items-center border-b border-[#333] bg-[#252526] overflow-x-auto overflow-y-hidden">
        {tabs.map((tab) => (
          <TabItem
            key={tab.filePath}
            tab={tab}
            isActive={tab.filePath === activeTabPath}
            onActivate={() => setActiveTab(tab.filePath)}
            onClose={(e) => handleCloseTab(tab.filePath, e)}
          />
        ))}
      </div>

      {/* Editor area */}
      <div className="flex-1 min-h-0">{editorContent}</div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 text-[11px] border-t border-[#333] bg-[#007acc] text-white">
        <div className="flex items-center gap-3">
          <span>{activeTab ? languageLabel : ''}</span>
          {isDirty && <span className="text-yellow-200">Modified</span>}
          {activeTab?.saving && <span className="text-blue-200">Saving...</span>}
        </div>
        <div className="flex items-center gap-3">
          {activeTab && !activeTab.loading && !activeTab.error && (
            <span>{activeTab.content.split('\n').length} lines</span>
          )}
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  );
}
