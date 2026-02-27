import { useState, useEffect, useRef } from 'react';
import wallpaperImg from '@/assets/wallpaper.jpg';
import logoImg from '@/assets/construct-logo.png';

interface WelcomeScreenProps {
  onComplete: () => void;
}

/**
 * macOS-style first-boot welcome screen.
 *
 * Phase 1: "Hello" in cursive with animated blue gradient — fades in, holds, fades out
 * Phase 2: Logo + "Welcome to construct.computer" + tagline — staggered entrance, holds, fades out
 * Phase 3: Entire overlay dissolves to reveal lock screen
 */
export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  // Phase 1 — Hello
  const [helloVisible, setHelloVisible] = useState(false);
  // Phase 2 — Welcome
  const [showWelcome, setShowWelcome] = useState(false);
  const [logoVisible, setLogoVisible] = useState(false);
  const [titleVisible, setTitleVisible] = useState(false);
  const [taglineVisible, setTaglineVisible] = useState(false);
  // Phase 3 — Overlay dissolve
  const [overlayVisible, setOverlayVisible] = useState(true);
  // Mount control
  const [showHello, setShowHello] = useState(true);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const t = (fn: () => void, ms: number) => {
      timers.push(setTimeout(fn, ms));
    };

    // Phase 1: Hello fade in
    t(() => setHelloVisible(true), 150);
    // Phase 1: Hello fade out
    t(() => setHelloVisible(false), 2800);

    // Phase 2: Switch to welcome, stagger elements in
    t(() => { setShowHello(false); setShowWelcome(true); }, 3700);
    t(() => setLogoVisible(true), 3850);
    t(() => setTitleVisible(true), 4100);
    t(() => setTaglineVisible(true), 4500);

    // Phase 2: Fade out welcome
    t(() => {
      setLogoVisible(false);
      setTitleVisible(false);
      setTaglineVisible(false);
    }, 6600);

    // Phase 3: Dissolve overlay
    t(() => setOverlayVisible(false), 7500);

    // Done
    t(() => onCompleteRef.current(), 8500);

    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 99999,
        opacity: overlayVisible ? 1 : 0,
        transition: 'opacity 1s ease-in-out',
      }}
    >
      {/* Wallpaper — always dark for dramatic effect */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${wallpaperImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      {/* Dark scrim + heavy blur */}
      <div className="absolute inset-0 backdrop-blur-2xl bg-black/60" />

      {/* Ambient glow behind content */}
      <div
        className="absolute rounded-full"
        style={{
          width: '40vw',
          height: '40vw',
          maxWidth: 500,
          maxHeight: 500,
          background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
          animation: 'welcome-glow-pulse 4s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />

      {/* ── Phase 1: "Hello" ── */}
      {showHello && (
        <h1
          className="hello-cursive select-none relative z-10"
          style={{
            fontSize: 'clamp(5rem, 14vw, 12rem)',
            lineHeight: 1,
            background: 'linear-gradient(135deg, #93C5FD 0%, #3B82F6 35%, #60A5FA 65%, #BFDBFE 100%)',
            backgroundSize: '200% 200%',
            animation: 'hello-gradient 4s ease infinite',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            opacity: helloVisible ? 1 : 0,
            transform: helloVisible ? 'scale(1)' : 'scale(0.92)',
            filter: helloVisible
              ? 'blur(0px) drop-shadow(0 4px 30px rgba(59,130,246,0.35))'
              : 'blur(8px) drop-shadow(0 4px 30px rgba(59,130,246,0))',
            transition: 'opacity 0.8s ease-out, transform 0.8s ease-out, filter 0.8s ease-out',
          }}
        >
          Hello
        </h1>
      )}

      {/* ── Phase 2: Logo + Welcome text ── */}
      {showWelcome && (
        <div className="flex flex-col items-center select-none relative z-10 px-6">
          {/* Logo */}
          <div
            style={{
              opacity: logoVisible ? 1 : 0,
              transform: logoVisible ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(10px)',
              transition: 'opacity 0.7s ease-out, transform 0.7s ease-out',
            }}
          >
            <img
              src={logoImg}
              alt="construct.computer"
              className="rounded-2xl"
              style={{
                width: 72,
                height: 72,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 60px rgba(59,130,246,0.15)',
              }}
            />
          </div>

          {/* Title group */}
          <div
            className="text-center mt-7"
            style={{
              opacity: titleVisible ? 1 : 0,
              transform: titleVisible ? 'translateY(0)' : 'translateY(16px)',
              transition: 'opacity 0.7s ease-out, transform 0.7s ease-out',
            }}
          >
            <p
              className="text-[15px] font-light tracking-widest uppercase mb-2"
              style={{
                color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.2em',
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              Welcome to
            </p>
            <h1
              className="text-4xl sm:text-5xl tracking-tight"
              style={{
                fontFamily: "'Playfair Display', serif",
                fontWeight: 700,
                color: 'white',
                filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.3))',
              }}
            >
              construct.<em style={{ fontStyle: 'italic' }}>computer</em>
            </h1>
          </div>

          {/* Tagline */}
          <p
            className="text-sm font-light mt-5 tracking-wide"
            style={{
              color: 'rgba(255,255,255,0.3)',
              opacity: taglineVisible ? 1 : 0,
              transform: taglineVisible ? 'translateY(0)' : 'translateY(8px)',
              transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
              textShadow: '0 1px 1px rgba(0,0,0,0.2)',
            }}
          >
            Your AI-powered cloud workspace
          </p>
        </div>
      )}
    </div>
  );
}
