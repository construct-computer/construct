import { useCallback } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { playSound, type SoundEffect } from '@/lib/sounds';

/**
 * Hook to play sound effects based on settings
 */
export function useSound() {
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  
  const play = useCallback(
    (sound: SoundEffect, volume?: number) => {
      if (soundEnabled) {
        playSound(sound, volume);
      }
    },
    [soundEnabled]
  );
  
  return { play, enabled: soundEnabled };
}
