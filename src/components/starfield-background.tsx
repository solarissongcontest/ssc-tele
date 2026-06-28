import { useEffect, useMemo, useRef } from "react";

type Star = {
  x: number;
  y: number;
  r: number;
  o: number;
  blur: number;
  tw: number; // twinkle phase
  vy: number; // slow vertical drift
};

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

/**
 * Full-screen starfield rendered to a fixed canvas behind all UI.
 * Mixes sharp, slightly blurred, and heavily blurred stars to fake depth,
 * with a gentle floating drift + twinkle so the background feels alive.
 */
export function StarfieldBackground() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const stars = useRef<Star[]>([]);
  const raf = useRef<number | null>(null);

  const density = useMemo(() => 0.00018, []); // stars per CSS pixel²

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const seed = () => {
      const count = Math.floor(width * height * density);
      const arr: Star[] = [];
      for (let i = 0; i < count; i++) {
        const depth = Math.random();
        const blur =
          depth < 0.55 ? 0 : depth < 0.85 ? rand(1, 2.5) : rand(3.5, 7);
        arr.push({
          x: Math.random() * width,
          y: Math.random() * height,
          r: depth < 0.55 ? rand(0.4, 1.1) : depth < 0.85 ? rand(0.8, 1.8) : rand(1.6, 3.2),
          o: depth < 0.55 ? rand(0.55, 1) : depth < 0.85 ? rand(0.3, 0.7) : rand(0.15, 0.4),
          blur,
          tw: Math.random() * Math.PI * 2,
          vy: rand(0.002, 0.012),
        });
      }
      stars.current = arr;
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    resize();
    window.addEventListener("resize", resize);

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      ctx.clearRect(0, 0, width, height);

      for (const s of stars.current) {
        s.tw += dt * 0.0015;
        s.y += s.vy * dt * 0.06;
        if (s.y > height + 6) s.y = -6;

        const tw = 0.75 + 0.25 * Math.sin(s.tw);
        const alpha = Math.min(1, s.o * tw);

        ctx.save();
        if (s.blur > 0) {
          ctx.filter = `blur(${s.blur}px)`;
        }
        // soft glow halo for brighter stars
        if (s.blur < 1 && s.r > 1) {
          const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4);
          grad.addColorStop(0, `rgba(180, 220, 255, ${alpha * 0.35})`);
          grad.addColorStop(1, "rgba(180, 220, 255, 0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.fillStyle = `rgba(235, 245, 255, ${alpha})`;
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [density]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ mixBlendMode: "screen" }}
    />
  );
}
