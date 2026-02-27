import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/lib/constants';

// ─── Wallpaper registry ────────────────────────────────────────────────────
import wpDeathStar from '@/assets/wallpapers/deathstar.jpg';
import wpCatGalaxy from '@/assets/wallpapers/catgalaxy.jpg';

export interface WallpaperOption {
  id: string;
  name: string;
  src: string;
}

export const WALLPAPERS: WallpaperOption[] = [
  { id: 'deathstar', name: 'Death Star', src: wpDeathStar },
  { id: 'catgalaxy', name: 'Cat Galaxy', src: wpCatGalaxy },
];

/** Look up wallpaper src by ID, falling back to the default */
export function getWallpaperSrc(id: string): string {
  return WALLPAPERS.find((w) => w.id === id)?.src ?? wpDeathStar;
}

// ─── Store ─────────────────────────────────────────────────────────────────
export type Theme = 'light' | 'dark';

interface SettingsState {
  theme: Theme;
  soundEnabled: boolean;
  wallpaperId: string;
  
  // Actions
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setSoundEnabled: (enabled: boolean) => void;
  toggleSound: () => void;
  setWallpaper: (id: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      soundEnabled: true,
      wallpaperId: 'deathstar',
      
      setTheme: (theme) => {
        // Update document class for CSS variables
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        set({ theme });
      },
      
      toggleTheme: () => {
        set((state) => {
          const newTheme = state.theme === 'light' ? 'dark' : 'light';
          if (newTheme === 'dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
          return { theme: newTheme };
        });
      },
      
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
      
      toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
      
      setWallpaper: (id) => set({ wallpaperId: id }),
    }),
    {
      name: STORAGE_KEYS.theme,
      onRehydrateStorage: () => (state) => {
        // Apply theme on hydration — dark is default
        if (!state || state.theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      },
    }
  )
);
