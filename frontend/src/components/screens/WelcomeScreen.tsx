import { useState, useEffect, useRef } from 'react';
import wallpaperImg from '@/assets/wallpaper.jpg';
import logoImg from '@/assets/construct-logo.png';

interface WelcomeScreenProps {
  onComplete: () => void;
}

/**
 * Premium first-boot welcome screen with cinematic transitions.
 *
 * Phase 1: "hello" — cursive greeting with luminous gradient, rises into view
 * Phase 2: Brand reveal — typographic "construct.computer" with staggered elements
 * Phase 3: Cinematic exit — content lifts away with depth blur, revealing login beneath
 */
export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
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
  const [showHello, setShowHello] = useState(true);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const t = (fn: () => void, ms: number) => {
      timers.push(setTimeout(fn, ms));
    };

    // ── Phase 1: "hello" ───────────────────────────────
    t(() => setHelloIn(true), 200);       // rise in
    t(() => setHelloOut(true), 4000);     // drift out (+1s)
    t(() => {                              // swap to phase 2
      setShowHello(false);
      setShowBrand(true);
    }, 4800);

    // ── Phase 2: Brand reveal ──────────────────────────
    t(() => setLineIn(true), 4900);       // decorative line draws
    t(() => setSubtitleIn(true), 5150);   // "Welcome to"
    t(() => setBrandIn(true), 5400);      // "construct.computer"
    t(() => setTaglineIn(true), 5850);    // tagline

    // Phase 2 exit
    t(() => setBrandOut(true), 8000);

    // ── Phase 3: Cinematic exit ────────────────────────
    t(() => setExiting(true), 8800);

    // Done — unmount
    t(() => onCompleteRef.current(), 10000);

    return () => timers.forEach(clearTimeout);
  }, []);

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
          backgroundImage: `url(${wallpaperImg})`,
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

      {/* Primary ambient glow — soft blue, centered */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '50vw',
          height: '50vw',
          maxWidth: 600,
          maxHeight: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.10) 0%, rgba(59,130,246,0.03) 50%, transparent 70%)',
          animation: 'welcome-glow-pulse 5s ease-in-out infinite',
        }}
      />

      {/* Secondary ambient glow — wider, warmer */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '80vw',
          height: '80vw',
          maxWidth: 900,
          maxHeight: 900,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(147,197,253,0.04) 0%, transparent 60%)',
          animation: 'welcome-glow-pulse 7s ease-in-out infinite reverse',
        }}
      />

      {/* ── Phase 1: "hello" ── */}
      {showHello && (
        <h1
          className="hello-cursive select-none relative z-10"
          style={{
            fontSize: 'clamp(5rem, 15vw, 13rem)',
            lineHeight: 1,
            letterSpacing: '-0.01em',
            background: 'linear-gradient(135deg, #60A5FA 0%, #818CF8 12%, #C084FC 24%, #F472B6 36%, #FB7185 48%, #FB923C 60%, #FBBF24 72%, #34D399 84%, #60A5FA 100%)',
            backgroundSize: '300% 300%',
            animation: 'hello-gradient 6s linear infinite',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            opacity: helloOut ? 0 : helloIn ? 1 : 0,
            transform: helloOut
              ? 'translateY(-24px)'
              : helloIn
                ? 'translateY(0)'
                : 'translateY(28px)',
            filter: helloOut
              ? 'blur(6px)'
              : helloIn
                ? `blur(0px) drop-shadow(0 0 40px rgba(59,130,246,0.3)) drop-shadow(0 0 80px rgba(59,130,246,0.15))`
                : 'blur(10px)',
            transition: helloOut
              ? `opacity 0.7s ease-in, transform 0.7s ease-in, filter 0.7s ease-in`
              : `opacity 1s ${ease}, transform 1s ${ease}, filter 1s ${ease}`,
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

          {/* Brand name — Geo: geometric, angular, techy */}
          <h1
            style={{
              fontFamily: "'Geo', sans-serif",
              fontSize: 'clamp(2.2rem, 6vw, 3.8rem)',
              lineHeight: 1.15,
              fontWeight: 400,
              letterSpacing: '0.04em',
              color: 'white',
              opacity: brandIn ? 1 : 0,
              transform: brandIn ? 'translateY(0)' : 'translateY(16px)',
              filter: brandIn
                ? 'drop-shadow(0 1px 8px rgba(0,0,0,0.25))'
                : 'drop-shadow(0 1px 8px rgba(0,0,0,0))',
              transition: `opacity 0.7s ${ease}, transform 0.7s ${ease}, filter 0.7s ${ease}`,
            }}
          >
            construct
            <span style={{ color: 'rgba(96,165,250,0.5)' }}>.</span>
            <span style={{ fontStyle: 'italic', color: 'rgba(96,165,250,0.85)' }}>computer</span>
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
