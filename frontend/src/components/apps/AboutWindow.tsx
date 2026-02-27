import constructLogo from '@/assets/construct-logo.png';
import type { WindowConfig } from '@/types';

interface AboutWindowProps {
  config: WindowConfig;
}

export function AboutWindow({ config: _config }: AboutWindowProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-[var(--color-surface)] p-8 text-center">
      {/* Logo */}
      <img
        src={constructLogo}
        alt="construct.computer"
        className="w-20 h-20 mb-5 rounded-2xl invert dark:invert-0"
        draggable={false}
      />
      
      <h1 className="text-xl" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500, letterSpacing: '-0.02em' }}>construct<span className="opacity-30 font-light">.</span><span className="font-light opacity-55">computer</span></h1>
      <p className="text-sm text-[var(--color-text-muted)] mt-1">
        Version 0.1.0
      </p>
      
      <div className="mt-6 text-sm text-[var(--color-text-muted)] max-w-sm leading-relaxed">
        <p>
          An AI agent platform where each user gets an isolated Docker container
          with a full desktop OS environment.
        </p>
        <p className="mt-3">
          Your AI agent (BoneClaw) runs autonomously 24/7, using a web browser,
          terminal, and file system to complete long-running tasks.
        </p>
      </div>
      
      <div className="mt-6 text-xs text-[var(--color-text-subtle)]">
        <p>Built with Vite + React + TailwindCSS</p>
        <p className="mt-1">Backend: ElysiaJS + SQLite + Docker</p>
      </div>
    </div>
  );
}
