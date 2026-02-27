import wallpaperImg from '@/assets/wallpaper.jpg';
import constructLogo from '@/assets/construct-logo.png';

interface ReturningUserScreenProps {
  /** If provided, shows "Click to unlock" instead of "Logging in..." */
  onUnlock?: () => void;
}

/**
 * Lock screen for authenticated users.
 *
 * Two modes:
 * - Auto-login (no onUnlock): spinner + "Logging in..." — shown briefly before auto-slide
 * - Locked (onUnlock provided): "Click to unlock" — shown after user locks the screen
 */
export function ReturningUserScreen({ onUnlock }: ReturningUserScreenProps) {
  const isLocked = !!onUnlock;

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
          backgroundImage: `url(${wallpaperImg})`,
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
          style={{ fontFamily: "'Geo', sans-serif", fontWeight: 400, letterSpacing: '0.04em', textShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
        >
          construct<span className="opacity-40">.</span><em className="italic opacity-60">computer</em>
        </h1>

        {isLocked ? (
          /* Locked mode — click to unlock */
          <p
            className="text-sm font-light text-black/60 dark:text-white/60 tracking-wide"
            style={{ textShadow: '0 1px 1px rgba(0,0,0,0.15)' }}
          >
            Click anywhere to unlock
          </p>
        ) : (
          /* Auto-login mode — spinner */
          <div className="flex items-center gap-2.5">
            <svg
              className="animate-spin w-4 h-4 text-black/60 dark:text-white/70"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="opacity-20"
              />
              <path
                d="M12 2a10 10 0 0 1 10 10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
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
