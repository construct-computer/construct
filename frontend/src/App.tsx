import { useEffect, useState } from 'react';
import { Desktop } from '@/components/desktop';
import { LoginScreen, RegisterScreen } from '@/components/auth';
import { BootScreen } from '@/components/BootScreen';
import { useAuthStore } from '@/stores/authStore';
import { useComputerStore } from '@/stores/agentStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { preloadAllSounds } from '@/lib/sounds';
import wallpaperImg from '@/assets/wallpaper.jpg';
import constructLogo from '@/assets/construct-logo.png';

type AuthView = 'login' | 'register';

function App() {
  const [authView, setAuthView] = useState<AuthView>('login');
  const { isAuthenticated, isLoading: authLoading, logout, checkAuth } = useAuthStore();
  const { isConnected } = useWebSocket();

  const computer = useComputerStore((s) => s.computer);
  const computerLoading = useComputerStore((s) => s.isLoading);
  const computerError = useComputerStore((s) => s.error);
  const fetchComputer = useComputerStore((s) => s.fetchComputer);

  // Preload sounds and check auth on mount
  useEffect(() => {
    preloadAllSounds();
    checkAuth();
  }, [checkAuth]);

  // Once authenticated, start provisioning the container
  useEffect(() => {
    if (isAuthenticated && !computer && !computerLoading) {
      fetchComputer();
    }
  }, [isAuthenticated, computer, computerLoading, fetchComputer]);

  // Auth loading
  if (authLoading) {
    return (
      <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div
          className="absolute inset-0 invert dark:invert-0"
          style={{ backgroundImage: `url(${wallpaperImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
        <div className="absolute inset-0 backdrop-blur-md bg-black/10 dark:bg-black/30" />
        <div className="relative z-10 text-center">
          <img
            src={constructLogo}
            alt="construct.computer"
            className="w-20 h-20 mx-auto mb-4 animate-pulse invert dark:invert-0"
            draggable={false}
          />
          <p className="text-sm text-black/50 dark:text-white/50
                        drop-shadow-[0_1px_1px_rgba(0,0,0,0.2)]">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return authView === 'login' ? (
      <LoginScreen onSwitchToRegister={() => setAuthView('register')} />
    ) : (
      <RegisterScreen onSwitchToLogin={() => setAuthView('login')} />
    );
  }

  // Authenticated but container still provisioning
  if (!computer || computerLoading) {
    return <BootScreen error={computerError} onRetry={fetchComputer} />;
  }

  // Ready - show desktop
  return (
    <div className="w-full h-full">
      <Desktop onLogout={logout} isConnected={isConnected} />
    </div>
  );
}

export default App;
