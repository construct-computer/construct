import { useState, useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useSettingsStore, getWallpaperSrc } from '@/stores/settingsStore';
import constructLogo from '@/assets/construct-logo.png';

const BOOT_STEPS = [
  'Connecting to server...',
  'Creating your container...',
  'Starting services...',
  'Initializing desktop...',
  'Almost ready...',
];

interface ReturningUserScreenProps {
  /** If provided, shows "Click to unlock" — user explicitly locked the screen */
  onUnlock?: () => void;
  /** Container is being provisioned */
  isProvisioning?: boolean;
  /** Container provisioning failed */
  provisionError?: string | null;
  /** Retry provisioning */
  onRetry?: () => void;
}

/**
 * Lock screen for authenticated users.
 *
 * Three modes:
 * - Provisioning: spinner + progress steps while container starts up
 * - Locked (onUnlock): "Click to unlock"
 * - Error: provision failed, retry button
 */
export function ReturningUserScreen({ onUnlock, isProvisioning, provisionError, onRetry }: ReturningUserScreenProps) {
  const isLocked = !!onUnlock;
  const wallpaperSrc = getWallpaperSrc(useSettingsStore((s) => s.wallpaperId));

  // Boot step cycling during provisioning
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!isProvisioning) return;
    setStepIndex(0);
    const interval = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, BOOT_STEPS.length - 1));
    }, 2500);
    return () => clearInterval(interval);
  }, [isProvisioning]);

  return (
    <div
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      onClick={isLocked ? onUnlock : undefined}
      style={{ cursor: isLocked ? 'pointer' : undefined }}
    >
      {/* Wallpaper */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${wallpaperSrc})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="absolute inset-0 backdrop-blur-md bg-black/10 dark:bg-black/30" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center select-none">
        {/* Logo */}
        <img
          src={constructLogo}
          alt="construct.computer"
          className="w-24 h-24 mb-5 invert dark:invert-0"
          draggable={false}
        />

        {/* Name */}
        <h1
          className="text-xl text-black/90 dark:text-white mb-6"
          style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500, letterSpacing: '-0.02em', textShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
        >
          construct<span className="opacity-30 font-light">.</span><span className="font-light opacity-55">computer</span>
        </h1>

        {provisionError ? (
          /* Error state */
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>{provisionError}</span>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg
                           bg-white/15 dark:bg-white/10 backdrop-blur-xl
                           border border-white/15 dark:border-white/10
                           text-black/80 dark:text-white/80
                           hover:bg-white/25 dark:hover:bg-white/15
                           transition-colors duration-200"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Try Again
              </button>
            )}
          </div>
        ) : isProvisioning ? (
          /* Provisioning state — spinner + boot step */
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2.5">
              <svg
                className="animate-spin w-4 h-4 text-black/60 dark:text-white/70"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12" cy="12" r="10"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                  className="opacity-20"
                />
                <path
                  d="M12 2a10 10 0 0 1 10 10"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                />
              </svg>
              <p
                className="text-sm font-light text-black/60 dark:text-white/60 tracking-wide"
                style={{ textShadow: '0 1px 1px rgba(0,0,0,0.15)' }}
              >
                {BOOT_STEPS[stepIndex]}
              </p>
            </div>
          </div>
        ) : isLocked ? (
          /* Locked mode — click to unlock */
          <p
            className="text-sm font-light text-black/60 dark:text-white/60 tracking-wide"
            style={{ textShadow: '0 1px 1px rgba(0,0,0,0.15)' }}
          >
            Click anywhere to unlock
          </p>
        ) : (
          /* Brief auto-login spinner (before provisioning state kicks in) */
          <div className="flex items-center gap-2.5">
            <svg
              className="animate-spin w-4 h-4 text-black/60 dark:text-white/70"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12" cy="12" r="10"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                className="opacity-20"
              />
              <path
                d="M12 2a10 10 0 0 1 10 10"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              />
            </svg>
            <p
              className="text-sm font-light text-black/70 dark:text-white/70 tracking-wide"
              style={{ textShadow: '0 1px 1px rgba(0,0,0,0.15)' }}
            >
              Logging in...
            </p>
          </div>
        )}
      </div>

      {/* Version — bottom */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center z-10">
        <p className="text-xs text-black/50 dark:text-white/50
                      drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]">
          construct.computer v0.1.0
        </p>
      </div>
    </div>
  );
}
