import * as React from "react";

import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

export interface SpringOptions {
  /** Pull toward the target. Higher = faster. */
  stiffness?: number;
  /** Friction. Lower = more wobble. stiffness 110 / damping 9 is the "jelly". */
  damping?: number;
  /** Value to start from on mount (animates to the first target). */
  from?: number;
  /** Delay before the first move, ms. */
  delay?: number;
}

export interface SpringState {
  value: number;
  velocity: number;
}

/**
 * A real damped spring driven by requestAnimationFrame. Returns the current
 * value and velocity (units per second) so callers can make things slosh in
 * proportion to how fast they move. Settles, then stops the loop.
 * With reduced motion it jumps straight to the target.
 */
export function useSpring(target: number, opts: SpringOptions = {}): SpringState {
  const { stiffness = 110, damping = 9, from = 0, delay = 0 } = opts;
  const reduced = usePrefersReducedMotion();
  const [state, setState] = React.useState<SpringState>({ value: from, velocity: 0 });
  const sim = React.useRef({ value: from, velocity: 0 });
  const targetRef = React.useRef(target);
  const raf = React.useRef<number | null>(null);
  const started = React.useRef(delay <= 0);

  targetRef.current = target;

  React.useEffect(() => {
    if (reduced) {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
      sim.current = { value: target, velocity: 0 };
      setState({ value: target, velocity: 0 });
      return;
    }
    let cancelled = false;
    const run = () => {
      if (cancelled || raf.current != null) return;
      let last: number | null = null;
      const step = (now: number) => {
        if (last == null) last = now;
        const dt = Math.min(0.033, (now - last) / 1000);
        last = now;
        const s = sim.current;
        const tgt = targetRef.current;
        for (let i = 0; i < 3; i++) {
          const h = dt / 3;
          const a = -stiffness * (s.value - tgt) - damping * s.velocity;
          s.velocity += a * h;
          s.value += s.velocity * h;
        }
        const settled = Math.abs(s.value - tgt) < 0.02 && Math.abs(s.velocity) < 0.05;
        if (settled) {
          s.value = tgt;
          s.velocity = 0;
        }
        setState({ value: s.value, velocity: s.velocity });
        raf.current = settled ? null : requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!started.current) {
      timer = setTimeout(() => {
        started.current = true;
        run();
      }, delay);
    } else {
      run();
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [target, reduced, stiffness, damping, delay]);

  React.useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      // Cleared, or a remount (StrictMode runs mount → unmount → mount)
      // sees a stale id, thinks the loop is running and never starts it.
      raf.current = null;
    },
    [],
  );

  return state;
}
