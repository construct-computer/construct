import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui';

interface BootScreenProps {
  error: string | null;
  onRetry: () => void;
}

const BOOT_STEPS = [
  'Connecting to server...',
  'Creating your container...',
  'Starting services...',
  'Initializing desktop environment...',
  'Almost ready...',
];

export function BootScreen({ error, onRetry }: BootScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  // Animate progress steps
  useEffect(() => {
    if (error) return;

    const stepInterval = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, BOOT_STEPS.length - 1));
    }, 2500);

    const progressInterval = setInterval(() => {
      setProgress((p) => {
        // Ease out - slow down as we approach 90%
        if (p >= 90) return p;
        const remaining = 90 - p;
        return p + remaining * 0.05;
      });
    }, 100);

    return () => {
      clearInterval(stepInterval);
      clearInterval(progressInterval);
    };
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
      <div className="text-center max-w-sm w-full px-6">
        {/* Logo */}
        <div className="w-20 h-20 rounded-2xl bg-[var(--color-accent)] flex items-center justify-center text-white text-3xl font-bold mb-6 mx-auto">
          C
        </div>

        <h1 className="text-xl mb-1" style={{ fontFamily: "'Geo', sans-serif", fontWeight: 400, letterSpacing: '0.04em' }}>construct<span className="opacity-40">.</span><em className="italic opacity-60">computer</em></h1>
        <p className="text-sm text-[var(--color-text-muted)] mb-8">
          Setting up your computer
        </p>

        {error ? (
          /* Error state */
          <div className="space-y-4">
            <div className="flex items-center gap-2 justify-center text-sm text-red-500">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
            <Button variant="primary" onClick={onRetry} className="mx-auto">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        ) : (
          /* Loading state */
          <div className="space-y-4">
            {/* Progress bar */}
            <div className="w-full h-1.5 bg-[var(--color-surface-raised)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Current step */}
            <div className="flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{BOOT_STEPS[stepIndex]}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
