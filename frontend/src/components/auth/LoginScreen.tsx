import { useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSound } from '@/hooks/useSound';
import wallpaperImg from '@/assets/wallpaper.jpg';
import constructLogo from '@/assets/construct-logo.png';

interface LoginScreenProps {
  onSwitchToRegister: () => void;
}

export function LoginScreen({ onSwitchToRegister }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error, clearError } = useAuthStore();
  const { theme, toggleTheme } = useSettingsStore();
  const { play } = useSound();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim() || !password.trim()) {
      play('error');
      return;
    }
    
    play('click');
    const success = await login(username, password);
    
    if (success) {
      play('open');
    } else {
      play('error');
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Wallpaper background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${wallpaperImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      {/* Blur overlay to soften the wallpaper */}
      <div className="absolute inset-0 backdrop-blur-md bg-black/10 dark:bg-black/30" />

      {/* Theme toggle — top right */}
      <button
        onClick={() => {
          play('click');
          toggleTheme();
        }}
        className="absolute top-4 right-4 z-10 p-2 rounded-full
                   bg-white/20 dark:bg-white/10 backdrop-blur-xl
                   border border-black/10 dark:border-white/15
                   text-black/70 dark:text-white/70
                   hover:bg-white/30 dark:hover:bg-white/20
                   transition-colors duration-200"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      {/* Lock screen card */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-xs">
        {/* Avatar / Logo */}
        <img
          src={constructLogo}
          alt="construct.computer"
          className="w-24 h-24 mb-4 invert dark:invert-0"
          draggable={false}
        />

        {/* Name */}
        <h1 className="text-xl text-black/90 dark:text-white mb-1
                       drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
            style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700 }}>
          construct.<em className="italic">computer</em>
        </h1>
        <p className="text-sm text-black/50 dark:text-white/50 mb-6
                      drop-shadow-[0_1px_1px_rgba(0,0,0,0.2)]">
          Sign in to your computer
        </p>

        {/* Glass form card */}
        <div className="w-full rounded-2xl overflow-hidden
                        bg-white/50 dark:bg-white/8 backdrop-blur-2xl
                        border border-black/10 dark:border-white/12
                        shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <div className="p-5">
            {/* Error message */}
            {error && (
              <div className="mb-4 p-2.5 text-sm rounded-lg
                              bg-red-500/10 dark:bg-red-500/15
                              text-red-700 dark:text-red-400
                              border border-red-500/20 dark:border-red-500/25">
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearError();
                }}
                placeholder="Username"
                autoComplete="username"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg
                           bg-white/60 dark:bg-white/8
                           border border-black/10 dark:border-white/12
                           text-black/90 dark:text-white
                           placeholder:text-black/30 dark:placeholder:text-white/30
                           focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50
                           transition-colors duration-150"
              />

              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError();
                }}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg
                           bg-white/60 dark:bg-white/8
                           border border-black/10 dark:border-white/12
                           text-black/90 dark:text-white
                           placeholder:text-black/30 dark:placeholder:text-white/30
                           focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50
                           transition-colors duration-150"
              />

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 text-sm font-medium rounded-lg
                           bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]
                           text-white disabled:opacity-50
                           transition-colors duration-150"
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
        </div>

        {/* Switch to register */}
        <p className="mt-5 text-sm text-black/50 dark:text-white/50
                      drop-shadow-[0_1px_1px_rgba(0,0,0,0.2)]">
          No account?{' '}
          <button
            type="button"
            onClick={() => {
              play('click');
              onSwitchToRegister();
            }}
            className="text-black/80 dark:text-white/80 font-medium hover:underline"
          >
            Create one
          </button>
        </p>
      </div>

      {/* Time display — bottom center, like a real lock screen */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center z-10">
        <p className="text-xs text-black/40 dark:text-white/30
                      drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]">
          construct.computer v0.1.0
        </p>
      </div>
    </div>
  );
}
