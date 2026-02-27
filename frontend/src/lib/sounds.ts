// Sound effect types
export type SoundEffect = 
  | 'click'
  | 'open'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'error'
  | 'notification'
  | 'startup';

// Audio cache
const audioCache = new Map<SoundEffect, HTMLAudioElement>();

// Sound file paths
const soundPaths: Record<SoundEffect, string> = {
  click: '/sounds/click.mp3',
  open: '/sounds/open.mp3',
  close: '/sounds/close.mp3',
  minimize: '/sounds/minimize.mp3',
  maximize: '/sounds/maximize.mp3',
  error: '/sounds/error.mp3',
  notification: '/sounds/notification.mp3',
  startup: '/sounds/startup.mp3',
};

// Default volume (0-1)
const DEFAULT_VOLUME = 0.3;

/**
 * Preload a sound effect
 */
export function preloadSound(sound: SoundEffect): void {
  if (audioCache.has(sound)) return;
  
  const audio = new Audio(soundPaths[sound]);
  audio.volume = DEFAULT_VOLUME;
  audio.preload = 'auto';
  audioCache.set(sound, audio);
}

/**
 * Preload all sound effects
 */
export function preloadAllSounds(): void {
  Object.keys(soundPaths).forEach((sound) => {
    preloadSound(sound as SoundEffect);
  });
}

/**
 * Play a sound effect
 */
export function playSound(sound: SoundEffect, volume = DEFAULT_VOLUME): void {
  try {
    let audio = audioCache.get(sound);
    
    if (!audio) {
      audio = new Audio(soundPaths[sound]);
      audioCache.set(sound, audio);
    }
    
    // Clone audio to allow overlapping sounds
    const clone = audio.cloneNode() as HTMLAudioElement;
    clone.volume = volume;
    clone.play().catch(() => {
      // Ignore errors (e.g., user hasn't interacted with page yet)
    });
  } catch {
    // Ignore errors
  }
}

/**
 * Create a sound player hook helper
 */
export function createSoundPlayer(enabled: boolean) {
  return (sound: SoundEffect, volume?: number) => {
    if (enabled) {
      playSound(sound, volume);
    }
  };
}
