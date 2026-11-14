// Opening animation (Control Room design): candies fly in from every side,
// form "DS", then burst away while the app fades in. About 2.4 s. It plays
// once per browser tab (sessionStorage), not on every page or refresh, so
// people who work in the app all day see it when they open it, not all the
// time. Any click or key skips it; with reduced motion it never plays.
import { useEffect, useRef, useState } from "react";

const KEY = "ds-intro-shown";
const COLORS = ["#6f9bff", "#3fd7e6", "#ff6fa8", "#ffb648", "#3ddc97", "#b08cff"];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function shouldPlay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  // Automated browsers (tests, the PDF/shell generator) never see it.
  if (navigator.webdriver) return false;
  try {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, "1");
  } catch {
    return false;
  }
  return true;
}

export function BootIntro() {
  const [show, setShow] = useState(false);
  // The app shows through while the candies burst away.
  const [fade, setFade] = useState(false);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (shouldPlay()) setShow(true);
  }, []);

  useEffect(() => {
    if (!show) return;
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    let raf = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setFade(true);
      // The burst runs to 2.4 s; the overlay goes once it is over.
      window.setTimeout(() => setShow(false), 950);
    };
    const skip = () => finish();
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);

    const start = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Sample the letters "DS" into points.
      const off = document.createElement("canvas");
      off.width = Math.round(W);
      off.height = Math.round(H);
      const o = off.getContext("2d");
      if (!o) return finish();
      o.fillStyle = "#fff";
      o.font = `800 ${Math.min(W * 0.36, 230)}px "Fira Sans", system-ui, sans-serif`;
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.fillText("DS", W / 2, H / 2 - 10);
      const img = o.getImageData(0, 0, off.width, off.height).data;
      const gap = Math.max(6, Math.round(Math.min(W, H) / 62));
      const pts: [number, number][] = [];
      for (let y = 0; y < off.height; y += gap)
        for (let x = 0; x < off.width; x += gap)
          if (img[(y * off.width + x) * 4 + 3] > 120) pts.push([x, y]);
      const P = pts.map(([x, y], i) => {
        const a = Math.random() * Math.PI * 2;
        const d = Math.max(W, H) * (0.55 + Math.random() * 0.5);
        return {
          tx: x,
          ty: y,
          sx: W / 2 + Math.cos(a) * d,
          sy: H / 2 + Math.sin(a) * d,
          d: Math.random() * 0.35,
          col: COLORS[i % COLORS.length],
          s: gap * 0.42 + Math.random() * 1.5,
          a,
        };
      });
      const t0 = performance.now();
      const frame = (now: number) => {
        const t = (now - t0) / 1000;
        c.clearRect(0, 0, W, H);
        for (const p of P) {
          let x: number;
          let y: number;
          let al = 1;
          let s = p.s;
          if (t < 1.55) {
            // Fly in and settle into the letters.
            const k = clamp((t - p.d) / 1.0, 0, 1);
            const e = 1 - Math.pow(1 - k, 4);
            x = lerp(p.sx, p.tx, e);
            y = lerp(p.sy, p.ty, e) + Math.sin(t * 6 + p.a) * (1 - e) * 10;
            al = clamp(k * 1.6, 0, 1);
          } else {
            // Burst outwards and fall away.
            const k = clamp((t - 1.55) / 0.8, 0, 1);
            const e = k * k;
            const ang = Math.atan2(p.ty - H / 2, p.tx - W / 2) + (p.a - 3) * 0.12;
            const dist = e * Math.max(W, H) * 0.8;
            x = p.tx + Math.cos(ang) * dist;
            y = p.ty + Math.sin(ang) * dist + e * 60;
            al = 1 - k;
            s = p.s * (1 + k);
          }
          c.globalAlpha = al;
          c.fillStyle = p.col;
          c.beginPath();
          c.arc(x, y, s, 0, Math.PI * 2);
          c.fill();
          c.globalAlpha = al * 0.5;
          c.fillStyle = "#fff";
          c.beginPath();
          c.arc(x - s * 0.3, y - s * 0.3, s * 0.3, 0, Math.PI * 2);
          c.fill();
        }
        c.globalAlpha = 1;
        if (t > 1.5) finish();
        if (t < 2.4) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };

    // Wait for Fira Sans so the letters have their shape.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const ready = fonts?.ready ?? Promise.resolve();
    let cancelled = false;
    const guard = window.setTimeout(() => !cancelled && start(), 900);
    void ready.then(() => {
      if (cancelled) return;
      window.clearTimeout(guard);
      start();
    });
    // Never block the app: gone after 4 s whatever happens.
    const safety = window.setTimeout(finish, 4000);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(guard);
      window.clearTimeout(safety);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, [show]);

  if (!show) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[100]"
      style={{
        background: fade ? "transparent" : "var(--background)",
        transition: "background-color 450ms ease",
      }}
    >
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
