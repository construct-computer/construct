import { useEffect, useState, useCallback } from 'react';
import { Desktop } from '@/components/desktop';
import { LoginScreen, RegisterScreen } from '@/components/auth';
import { ReturningUserScreen } from '@/components/screens/ReturningUserScreen';
import { RebootingScreen } from '@/components/screens/RebootingScreen';
import { WelcomeScreen } from '@/components/screens/WelcomeScreen';
import { BootScreen } from '@/components/BootScreen';
import { useAuthStore } from '@/stores/authStore';
import { useComputerStore } from '@/stores/agentStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { preloadAllSounds } from '@/lib/sounds';
import * as api from '@/services/api';

type AuthView = 'login' | 'register';
type RebootStatus = 'stopping' | 'updating' | 'starting' | 'done' | 'error';

/**
 * App orchestrates the full boot flow:
 *
 *   1. Black screen while checking auth
 *   2. If not logged in: WelcomeScreen ("Hello" → "Welcome to..." → fade out) → Lock screen
 *   3. On login success: lock screen slides up to reveal Desktop
 *   4. If returning with valid session: skip welcome, brief lock screen, auto-slide
 *   5. Lock Screen: slides lock screen back down without logging out
 *   6. Restart: shows rebooting screen, calls backend reboot, re-provisions
 */
function App() {
  const [authView, setAuthView] = useState<AuthView>('login');
  const [showWelcome, setShowWelcome] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [slidingUp, setSlidingUp] = useState(false);
  const [lockScreenGone, setLockScreenGone] = useState(false);

  // Reboot state
  const [rebooting, setRebooting] = useState(false);
  const [rebootStatus, setRebootStatus] = useState<RebootStatus>('stopping');
  const [rebootError, setRebootError] = useState<string | null>(null);

  const { isAuthenticated, isLoading: authLoading, logout, checkAuth } = useAuthStore();
  const { isConnected } = useWebSocket();

  const computer = useComputerStore((s) => s.computer);
  const computerLoading = useComputerStore((s) => s.isLoading);
  const computerError = useComputerStore((s) => s.error);
  const fetchComputer = useComputerStore((s) => s.fetchComputer);
  const unsubscribeFromComputer = useComputerStore((s) => s.unsubscribeFromComputer);

  // Preload sounds and check auth on mount
  useEffect(() => {
    preloadAllSounds();
    checkAuth().then(() => setAuthChecked(true));
  }, [checkAuth]);

  // After auth check: show welcome if not logged in, auto-slide if logged in
  useEffect(() => {
    if (!authChecked) return;

    if (!isAuthenticated) {
      setShowWelcome(true);
    } else {
      // Returning user with valid session — auto-slide up
      setTimeout(() => {
        setSlidingUp(true);
        setTimeout(() => setLockScreenGone(true), 700);
      }, 600);
    }
  }, [authChecked, isAuthenticated]);

  // Once authenticated, start provisioning the container
  useEffect(() => {
    if (isAuthenticated && !computer && !computerLoading && !rebooting) {
      fetchComputer();
    }
  }, [isAuthenticated, computer, computerLoading, rebooting, fetchComputer]);

  // Watch for auth state change (login success) — trigger slide-up
  const [prevAuth, setPrevAuth] = useState(false);
  useEffect(() => {
    if (isAuthenticated && !prevAuth && authChecked) {
      setTimeout(() => {
        setSlidingUp(true);
        setTimeout(() => setLockScreenGone(true), 700);
      }, 300);
    }
    setPrevAuth(isAuthenticated);
  }, [isAuthenticated, prevAuth, authChecked]);

  const handleWelcomeComplete = useCallback(() => {
    setShowWelcome(false);
  }, []);

  const handleLogout = useCallback(() => {
    setLockScreenGone(false);
    setSlidingUp(false);
    setShowWelcome(true);
    logout();
  }, [logout]);

  // Whether the lock screen is showing because the user explicitly locked
  const [isLocked, setIsLocked] = useState(false);
  // Whether the lock screen is currently sliding down into view
  const [slidingDown, setSlidingDown] = useState(false);

  // ── Lock Screen: slide in from top ──
  const handleLockScreen = useCallback(() => {
    // Mount the lock screen off-screen above, then animate it down
    setSlidingUp(false);
    setSlidingDown(false); // start at translateY(-100%)
    setLockScreenGone(false);
    setIsLocked(true);

    // Trigger slide-down on next frame so the transition fires
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSlidingDown(true);
      });
    });
  }, []);

  // ── Unlock: slide the lock screen back up ──
  const handleUnlock = useCallback(() => {
    setSlidingDown(false);
    setSlidingUp(true);
    setTimeout(() => {
      setLockScreenGone(true);
      setIsLocked(false);
    }, 700);
  }, []);

  // ── Restart: stop container → update → start → reconnect ──
  const handleRestart = useCallback(async () => {
    const instanceId = useComputerStore.getState().instanceId;
    if (!instanceId) return;

    setRebooting(true);
    setRebootStatus('stopping');
    setRebootError(null);

    // Disconnect all WebSockets first
    unsubscribeFromComputer();

    // Simulate progress stages while the backend does the work
    const stageTimer = setTimeout(() => setRebootStatus('updating'), 2000);
    const stageTimer2 = setTimeout(() => setRebootStatus('starting'), 5000);

    try {
      const result = await api.rebootInstance(instanceId);

      clearTimeout(stageTimer);
      clearTimeout(stageTimer2);

      if (!result.success) {
        setRebootStatus('error');
        setRebootError(result.error || 'Restart failed');
        // Auto-dismiss error after 3s and try to recover
        setTimeout(() => {
          setRebooting(false);
          fetchComputer();
        }, 3000);
        return;
      }

      setRebootStatus('done');

      // Brief pause on "done" then dismiss and re-fetch
      setTimeout(() => {
        setRebooting(false);
        // Clear old computer state so fetchComputer shows BootScreen then Desktop
        useComputerStore.setState({ computer: null, instanceId: null, isLoading: false, error: null });
        fetchComputer();
      }, 800);
    } catch (err) {
      clearTimeout(stageTimer);
      clearTimeout(stageTimer2);
      setRebootStatus('error');
      setRebootError(err instanceof Error ? err.message : 'Restart failed');
      setTimeout(() => {
        setRebooting(false);
        fetchComputer();
      }, 3000);
    }
  }, [unsubscribeFromComputer, fetchComputer]);

  // ── Black screen while checking auth ──
  if (!authChecked) {
    return <div className="fixed inset-0 bg-black" />;
  }

  return (
    <>
      {/* Layer 1: Desktop (bottom) — only render when authenticated */}
      {isAuthenticated && (
        <div className="fixed inset-0">
          {!computer || computerLoading ? (
            <BootScreen error={computerError} onRetry={fetchComputer} />
          ) : (
            <Desktop
              onLogout={handleLogout}
              onLockScreen={handleLockScreen}
              onRestart={handleRestart}
              isConnected={isConnected}
            />
          )}
        </div>
      )}

      {/* Layer 2: Lock screen — slides up to unlock, slides down from top to lock */}
      {!lockScreenGone && (
        <div
          className="fixed inset-0"
          // Prevent browser password autofill from focusing inputs while welcome screen is visible
          {...((showWelcome && !isAuthenticated) ? { inert: true } as any : {})}
          style={{
            zIndex: 9999,
            transform: slidingUp
              ? 'translateY(-100%)'           // unlocking: slide off above
              : isLocked && !slidingDown
                ? 'translateY(-100%)'         // locking: start above viewport
                : 'translateY(0)',            // resting / sliding down into view
            transition: slidingUp
              ? 'transform 0.7s cubic-bezier(0.4, 0.0, 0.2, 1)'
              : slidingDown
                ? 'transform 0.5s cubic-bezier(0.4, 0.0, 0.2, 1)'
                : 'none',
          }}
        >
          {isAuthenticated ? (
            <ReturningUserScreen onUnlock={isLocked ? handleUnlock : undefined} />
          ) : authView === 'login' ? (
            <LoginScreen onSwitchToRegister={() => setAuthView('register')} />
          ) : (
            <RegisterScreen onSwitchToLogin={() => setAuthView('login')} />
          )}
        </div>
      )}

      {/* Layer 3: Welcome screen (topmost) — always shown when not logged in */}
      {showWelcome && !isAuthenticated && (
        <WelcomeScreen onComplete={handleWelcomeComplete} />
      )}

      {/* Layer 4: Rebooting overlay (above everything) */}
      {rebooting && (
        <RebootingScreen status={rebootStatus} error={rebootError} />
      )}
    </>
  );
}

export default App;
