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

/**
 * Install a global click-sound listener via event delegation.
 * Plays the "click" sound for any interactive element (button, link, input, etc.).
 * Uses a short cooldown so components that already call play('click') don't double-fire.
 *
 * @param isEnabled — function that returns whether sounds are currently enabled
 * @returns cleanup function to remove the listener
 */
export function installGlobalClickSound(isEnabled: () => boolean): () => void {
  let lastPlayedAt = 0;
  const COOLDOWN_MS = 60; // ignore rapid duplicate plays

  /** Check whether an element (or an ancestor) is interactive / clickable. */
  function isInteractive(el: HTMLElement | null): boolean {
    while (el) {
      const tag = el.tagName;
      if (
        tag === 'BUTTON' ||
        tag === 'A' ||
        tag === 'SELECT' ||
        tag === 'SUMMARY' ||
        el.getAttribute('role') === 'button' ||
        el.getAttribute('role') === 'menuitem' ||
        el.getAttribute('role') === 'tab' ||
        el.getAttribute('role') === 'option' ||
        (tag === 'INPUT' && ['checkbox', 'radio', 'submit', 'reset', 'button'].includes(
          (el as HTMLInputElement).type,
        ))
      ) {
        return true;
      }
      // Stop at common boundaries so we don't walk the entire DOM
      if (tag === 'BODY' || tag === 'HTML') break;
      el = el.parentElement;
    }
    return false;
  }

  function handler(e: MouseEvent) {
    if (!isEnabled()) return;
    if (!isInteractive(e.target as HTMLElement)) return;

    const now = performance.now();
    if (now - lastPlayedAt < COOLDOWN_MS) return;
    lastPlayedAt = now;

    playSound('click');
  }

  document.addEventListener('click', handler, { capture: true });
  return () => document.removeEventListener('click', handler, { capture: true });
}
