import { useSettingsStore, getWallpaperSrc } from '@/stores/settingsStore';

export function Wallpaper() {
  const wallpaperId = useSettingsStore((s) => s.wallpaperId);

  return (
    <div
      className="absolute inset-0"
      style={{
        backgroundImage: `url(${getWallpaperSrc(wallpaperId)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        zIndex: 0,
      }}
    />
  );
}
