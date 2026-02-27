import constructLogo from '@/assets/construct-logo.png';

interface RebootingScreenProps {
  status: 'stopping' | 'updating' | 'starting' | 'done' | 'error';
  error?: string | null;
}

const STATUS_LABELS: Record<RebootingScreenProps['status'], string> = {
  stopping: 'Shutting down...',
  updating: 'Updating container...',
  starting: 'Starting up...',
  done: 'Almost ready...',
  error: 'Restart failed',
};

/**
 * Full-screen reboot overlay. Shown while the container is being
 * destroyed, recreated, and reconnected.
 */
export function RebootingScreen({ status, error }: RebootingScreenProps) {
  const isError = status === 'error';
  const label = isError && error ? error : STATUS_LABELS[status];

  return (
    <div className="fixed inset-0 z-[99998] flex items-center justify-center bg-black">
      <div className="flex flex-col items-center select-none">
        {/* Logo */}
        <img
          src={constructLogo}
          alt="construct.computer"
          className="w-16 h-16 mb-8"
          draggable={false}
        />

        {/* Spinner or error icon */}
        {isError ? (
          <div className="w-5 h-5 mb-4 text-red-400">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        ) : (
          <svg
            className="animate-spin w-5 h-5 mb-4 text-white/60"
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
        )}

        {/* Status label */}
        <p
          className={`text-sm font-light tracking-wide ${
            isError ? 'text-red-400' : 'text-white/60'
          }`}
        >
          {label}
        </p>

        {/* Progress dots for non-error states */}
        {!isError && (
          <div className="flex items-center gap-1.5 mt-6">
            {(['stopping', 'updating', 'starting', 'done'] as const).map((step, i) => {
              const steps = ['stopping', 'updating', 'starting', 'done'];
              const currentIdx = steps.indexOf(status);
              const isCurrent = status === step;
              const isPast = i < currentIdx;
              return (
                <div
                  key={step}
                  className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                    isCurrent
                      ? 'bg-white/80 scale-125'
                      : isPast
                        ? 'bg-white/40'
                        : 'bg-white/15'
                  }`}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
