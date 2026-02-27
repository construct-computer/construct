import type { WindowConfig } from '@/types';

interface EditorWindowProps {
  config: WindowConfig;
}

export function EditorWindow({ config: _config }: EditorWindowProps) {
  const sampleCode = `// Example file
function hello() {
  console.log("Hello from construct.computer!");
}

hello();`;

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      {/* Tab bar */}
      <div className="flex items-center border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <div className="px-3 py-1.5 text-xs border-r border-[var(--color-border)] bg-[var(--color-surface)]">
          untitled.js
        </div>
      </div>
      
      {/* Editor content */}
      <div className="flex-1 flex">
        {/* Line numbers */}
        <div className="w-10 bg-[var(--color-surface-raised)] border-r border-[var(--color-border)] text-right pr-2 py-2 text-xs font-mono text-[var(--color-text-muted)]">
          {sampleCode.split('\n').map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        
        {/* Code */}
        <pre className="flex-1 p-2 text-xs font-mono overflow-auto">
          <code>{sampleCode}</code>
        </pre>
      </div>
      
      {/* Status bar */}
      <div className="flex items-center justify-between px-2 py-1 text-xs border-t border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]">
        <span>JavaScript</span>
        <span>Ln 1, Col 1</span>
      </div>
    </div>
  );
}
