import { useState, useEffect, useRef, useCallback } from 'react';
import { Power } from 'lucide-react';
import { useSettingsStore, getWallpaperSrc } from '@/stores/settingsStore';
import { useSound } from '@/hooks/useSound';
import logoImg from '@/assets/construct-logo.png';

interface WelcomeScreenProps {
  onComplete: () => void;
}

/**
 * Premium first-boot welcome screen with cinematic transitions.
 *
 * Phase 0: Power-on — user clicks the power button to begin
 * Phase 1: "hello" — cursive greeting with luminous gradient, rises into view
 * Phase 2: Brand reveal — typographic "construct.computer" with staggered elements
 * Phase 3: Cinematic exit — content lifts away with depth blur, revealing login beneath
 */
export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  const wallpaperSrc = getWallpaperSrc(useSettingsStore((s) => s.wallpaperId));
  const { play } = useSound();

  // Phase 0: Power-on gate
  const [poweredOn, setPoweredOn] = useState(false);
  const [powerFading, setPowerFading] = useState(false);

  // Phase 1
  const [helloIn, setHelloIn] = useState(false);
  const [helloOut, setHelloOut] = useState(false);

  // Phase 2
  const [showBrand, setShowBrand] = useState(false);
  const [lineIn, setLineIn] = useState(false);
  const [subtitleIn, setSubtitleIn] = useState(false);
  const [brandIn, setBrandIn] = useState(false);
  const [taglineIn, setTaglineIn] = useState(false);
  const [brandOut, setBrandOut] = useState(false);

  // Phase 3
  const [exiting, setExiting] = useState(false);

  // Mount control
  const [showHello, setShowHello] = useState(false);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // ── Power-on handler ─────────────────────────────────────────────────
  const handlePowerOn = useCallback(() => {
    if (poweredOn) return;
    setTimeout(() => play('startup', 0.69), 1100);
    setPowerFading(true);
    // After the power button fades, start the sequence
    setTimeout(() => {
      setPoweredOn(true);
      setShowHello(true);
    }, 600);
  }, [poweredOn, play]);

  // ── Animation sequence (starts after power-on) ───────────────────────
  useEffect(() => {
    if (!poweredOn) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const t = (fn: () => void, ms: number) => {
      timers.push(setTimeout(fn, ms));
    };

    // Phase 1: "hello"
    t(() => setHelloIn(true), 200);
    t(() => setHelloOut(true), 4000);
    t(() => {
      setShowHello(false);
      setShowBrand(true);
    }, 4800);

    // Phase 2: Brand reveal
    t(() => setLineIn(true), 4900);
    t(() => setSubtitleIn(true), 5150);
    t(() => setBrandIn(true), 5400);
    t(() => setTaglineIn(true), 5850);
    t(() => setBrandOut(true), 8000);

    // Phase 3: Cinematic exit
    t(() => setExiting(true), 8800);
    t(() => onCompleteRef.current(), 10000);

    return () => timers.forEach(clearTimeout);
  }, [poweredOn]);

  // Shared easing
  const ease = 'cubic-bezier(0.16, 1, 0.3, 1)'; // expo out

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 99999,
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'scale(1.04)' : 'scale(1)',
        filter: exiting ? 'blur(6px)' : 'blur(0px)',
        transition: `opacity 1.2s ${ease}, transform 1.2s ${ease}, filter 1.2s ${ease}`,
      }}
    >
      {/* Wallpaper base */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${wallpaperSrc})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      {/* Dark cinematic scrim */}
      <div className="absolute inset-0 backdrop-blur-3xl bg-black/70" />

      {/* Vignette overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)',
        }}
      />

      {/* Subtle ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '60vw',
          height: '60vw',
          maxWidth: 700,
          maxHeight: 700,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 60%)',
          animation: 'welcome-glow-pulse 6s ease-in-out infinite',
        }}
      />

      {/* ── Phase 0: Power-on button ── */}
      {!poweredOn && (
        <div
          className="flex flex-col items-center gap-4 relative z-10 select-none"
          style={{
            opacity: powerFading ? 0 : 1,
            transform: powerFading ? 'scale(0.95)' : 'scale(1)',
            transition: `opacity 0.5s ${ease}, transform 0.5s ${ease}`,
          }}
        >
          <button
            className="group flex items-center justify-center w-16 h-16 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm hover:bg-white/10 hover:border-white/20 transition-all duration-300"
            onClick={handlePowerOn}
          >
            <Power className="w-6 h-6 text-white/50 group-hover:text-white/80 transition-colors duration-300" />
          </button>
          <span className="text-[11px] text-white/25 tracking-widest uppercase">Power on</span>
        </div>
      )}

      {/* ── Phase 1: "hello" ── */}
      {showHello && (
        <h1
          className="hello-cursive select-none relative z-10"
          style={{
            fontSize: 'clamp(5rem, 15vw, 13rem)',
            lineHeight: 1,
            letterSpacing: '-0.01em',
            // Starts fully warm (red/orange); green/emerald creeps in from the right.
            background: 'linear-gradient(90deg, #EF4444 0%, #FB923C 20%, #EF4444 38%, #FB923C 48%, #C4A030 55%, #39FF14 65%, #00FF66 75%, #39FF14 88%, #00FF66 100%)',
            backgroundSize: '250% 100%',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            // Handwriting mask — soft-edge sweep left to right
            ...(helloIn ? {
              WebkitMaskImage: 'linear-gradient(to right, black calc(var(--hello-reveal) - 6%), transparent var(--hello-reveal))',
              maskImage: 'linear-gradient(to right, black calc(var(--hello-reveal) - 6%), transparent var(--hello-reveal))',
            } : {}),
            // One-shot gradient shift (green creeps in from right) + handwriting reveal
            animation: helloIn
              ? 'hello-gradient 6s ease-in forwards, hello-write 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards'
              : 'none',
            opacity: helloOut ? 0 : helloIn ? 1 : 0,
            transform: helloOut ? 'translateY(-24px)' : 'none',
            transition: helloOut
              ? 'opacity 0.7s ease-in, transform 0.7s ease-in'
              : 'opacity 0.15s ease-out',
          }}
        >
          hello
        </h1>
      )}

      {/* ── Phase 2: Brand reveal ── */}
      {showBrand && (
        <div
          className="flex flex-col items-center select-none relative z-10"
          style={{
            opacity: brandOut ? 0 : 1,
            transform: brandOut ? 'translateY(-12px) scale(0.98)' : 'translateY(0) scale(1)',
            transition: `opacity 0.8s ease-in, transform 0.8s ease-in`,
          }}
        >
          {/* Logo */}
          <div
            style={{
              opacity: lineIn ? 1 : 0,
              transform: lineIn ? 'scale(1)' : 'scale(0.85)',
              transition: `opacity 0.7s ${ease}, transform 0.7s ${ease}`,
              marginBottom: 32,
            }}
          >
            <img
              src={logoImg}
              alt=""
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)',
              }}
            />
          </div>

          {/* "Welcome to" */}
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.25em',
              color: 'rgba(255,255,255,0.4)',
              marginBottom: 14,
              opacity: subtitleIn ? 1 : 0,
              transform: subtitleIn ? 'translateY(0)' : 'translateY(12px)',
              transition: `opacity 0.6s ${ease}, transform 0.6s ${ease}`,
            }}
          >
            Welcome to
          </p>

          {/* Brand name */}
          <h1
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 'clamp(2rem, 5vw, 3.2rem)',
              lineHeight: 1.2,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              color: 'white',
              opacity: brandIn ? 1 : 0,
              transform: brandIn ? 'translateY(0)' : 'translateY(16px)',
              transition: `opacity 0.7s ${ease}, transform 0.7s ${ease}`,
            }}
          >
            construct
            <span style={{ fontWeight: 300, color: 'rgba(255,255,255,0.3)' }}>.</span>
            <span style={{ fontWeight: 300, color: 'rgba(255,255,255,0.55)' }}>computer</span>
          </h1>

          {/* Tagline */}
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              fontWeight: 400,
              letterSpacing: '0.02em',
              color: 'rgba(255,255,255,0.25)',
              marginTop: 16,
              opacity: taglineIn ? 1 : 0,
              transform: taglineIn ? 'translateY(0)' : 'translateY(8px)',
              transition: `opacity 0.6s ${ease}, transform 0.6s ${ease}`,
            }}
          >
            Your AI-powered cloud workspace
          </p>
        </div>
      )}
    </div>
  );
}
