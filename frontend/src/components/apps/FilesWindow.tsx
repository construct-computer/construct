import { Folder, File, HardDrive } from 'lucide-react';
import type { WindowConfig } from '@/types';

interface FilesWindowProps {
  config: WindowConfig;
}

export function FilesWindow({ config }: FilesWindowProps) {
  return (
    <div className="flex h-full bg-[var(--color-surface)]">
      {/* Sidebar */}
      <div className="w-40 border-r border-[var(--color-border)] p-2 bg-[var(--color-surface-raised)]">
        <div className="text-xs font-medium text-[var(--color-text-muted)] mb-2">
          Locations
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 px-2 py-1 text-sm rounded-md hover:bg-[var(--color-accent)] hover:text-white cursor-pointer">
            <HardDrive className="w-4 h-4" />
            <span>Root</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-sm rounded-md hover:bg-[var(--color-accent)] hover:text-white cursor-pointer">
            <Folder className="w-4 h-4" />
            <span>Home</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-sm rounded-md hover:bg-[var(--color-accent)] hover:text-white cursor-pointer">
            <Folder className="w-4 h-4" />
            <span>Documents</span>
          </div>
        </div>
      </div>
      
      {/* File list */}
      <div className="flex-1 p-2">
        <div className="text-xs text-[var(--color-text-muted)] mb-2">
          /home/agent
        </div>
        <div className="grid grid-cols-4 gap-2">
          {['Documents', 'Downloads', 'Pictures', 'Scripts'].map((name) => (
            <div
              key={name}
              className="flex flex-col items-center p-2 rounded-lg hover:bg-[var(--color-accent-muted)] cursor-pointer"
            >
              <Folder className="w-8 h-8 text-[var(--color-accent)]" />
              <span className="text-xs mt-1 text-center">{name}</span>
            </div>
          ))}
          {['notes.txt', 'config.json'].map((name) => (
            <div
              key={name}
              className="flex flex-col items-center p-2 rounded-lg hover:bg-[var(--color-accent-muted)] cursor-pointer"
            >
              <File className="w-8 h-8 text-[var(--color-text-muted)]" />
              <span className="text-xs mt-1 text-center">{name}</span>
            </div>
          ))}
        </div>
        {config.agentId && (
          <div className="mt-4 text-xs text-[var(--color-text-muted)]">
            Agent: {config.agentId}
          </div>
        )}
      </div>
    </div>
  );
}
