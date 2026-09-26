import * as React from "react";
import { createPortal } from "react-dom";

import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

import { CANDY, GummyBearShape } from "./GummyBear";

interface Bear {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  s: number;
  c: string;
  age: number;
  life: number;
}

const GRAVITY = 1900;

/**
 * Celebration for a day saved at or above target — and only then. Bears fly
 * out of an element with real gravity, bounce on the bottom of the screen and
 * fade out after ~3s. Renders a fixed, click-through layer in a portal.
 * Reduced motion: nothing flies (the success message still shows).
 *
 *   const gummy = useGummyBurst();
 *   gummy.burstFrom(buttonEl);
 *   return <>{...}{gummy.layer}</>;
 *
 * The per-frame state lives in the layer component, not in the hook: the
 * page that calls the hook does not re-render 60 times a second while the
 * bears fly (on a big form that made every frame slow and the bears crawl).
 */
export function useGummyBurst(count = 30) {
  const reduced = usePrefersReducedMotion();
  const store = React.useRef<GummyStore>({ bears: [], kick: null });

  const burstAt = React.useCallback(
    (x: number, y: number) => {
      if (reduced || typeof window === "undefined") return;
      const small = window.innerWidth < 640;
      for (let i = 0; i < count; i++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.1;
        const sp = (small ? 480 : 700) + Math.random() * (small ? 480 : 700);
        store.current.bears.push({
          x,
          y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          r: Math.random() * 360,
          vr: (Math.random() - 0.5) * 900,
          s: (small ? 0.75 : 0.9) + Math.random() * 0.8,
          c: CANDY[i % CANDY.length],
          age: 0,
          life: 2.6 + Math.random() * 0.9,
        });
      }
      store.current.kick?.();
    },
    [reduced, count],
  );

  const burstFrom = React.useCallback(
    (el: Element | null | undefined) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      burstAt(r.left + r.width / 2, r.top + r.height / 2);
    },
    [burstAt],
  );

  const layer = React.useMemo(() => <GummyLayer store={store} />, []);

  return { burstAt, burstFrom, layer };
}

interface GummyStore {
  bears: Bear[];
  /** Set by the mounted layer: starts its animation loop. */
  kick: (() => void) | null;
}

function GummyLayer({ store }: { store: React.RefObject<GummyStore> }) {
  const raf = React.useRef<number | null>(null);
  const [, setFrame] = React.useState(0);
  const [mounted, setMounted] = React.useState(false);

  const loop = React.useCallback(() => {
    if (raf.current != null) return;
    let last: number | null = null;
    const step = (now: number) => {
      if (last == null) last = now;
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const floor = window.innerHeight - 16;
      const right = window.innerWidth - 12;
      const next: Bear[] = [];
      for (const b of store.current.bears) {
        b.age += dt;
        b.vy += GRAVITY * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.r += b.vr * dt;
        if (b.y > floor) {
          b.y = floor;
          b.vy *= -0.45;
          b.vx *= 0.8;
          b.vr *= 0.6;
        }
        if (b.x < 12 || b.x > right) {
          b.vx *= -0.6;
          b.x = Math.max(12, Math.min(right, b.x));
        }
        if (b.age < b.life) next.push(b);
      }
      store.current.bears = next;
      setFrame((f) => f + 1);
      raf.current = next.length ? requestAnimationFrame(step) : null;
    };
    raf.current = requestAnimationFrame(step);
  }, [store]);

  React.useEffect(() => {
    const s = store.current;
    setMounted(true);
    s.kick = loop;
    if (s.bears.length) loop();
    return () => {
      s.kick = null;
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [store, loop]);

  const bears = store.current.bears;
  if (!mounted || bears.length === 0) return null;
  return createPortal(
    <svg aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70] h-full w-full">
      {bears.map((b, i) => {
        const grow = Math.min(1, b.age / 0.12);
        const o = b.age > b.life - 0.5 ? Math.max(0, (b.life - b.age) / 0.5) : 1;
        return (
          <g
            key={i}
            transform={`translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${b.r.toFixed(1)}) scale(${(b.s * grow).toFixed(2)})`}
            opacity={o}
            style={{ fill: b.c }}
          >
            <GummyBearShape />
          </g>
        );
      })}
    </svg>,
    document.body,
  );
}
