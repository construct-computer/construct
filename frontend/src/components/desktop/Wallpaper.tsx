import wallpaperImg from '@/assets/wallpaper.jpg';

export function Wallpaper() {
  return (
    <div
      className="absolute inset-0"
      style={{
        backgroundImage: `url(${wallpaperImg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        zIndex: 0,
      }}
    />
  );
}
