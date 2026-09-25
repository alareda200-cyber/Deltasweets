import * as React from "react";

import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

interface TiltState {
  rx: number;
  ry: number;
  gx: number;
  gy: number;
  on: boolean;
}

const REST: TiltState = { rx: 0, ry: 0, gx: 50, gy: 50, on: false };

/**
 * Card tilts toward the mouse with a soft spotlight under the cursor, then
 * springs back. Mouse only — touch and pen never tilt, and reduced motion
 * turns it off. Use on hero cards only (one per page, or a KPI row).
 *
 *   const tilt = useTilt();
 *   <section {...tilt.handlers} style={tilt.style} className="relative">
 *     <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={tilt.glareStyle} />
 *
 * Don't put an entrance animation that ends on `transform` (fill-mode both /
 * forwards) on the same element — it would override the tilt. `ds-rise` uses
 * `backwards`, so it is safe.
 */
export function useTilt(max = 8) {
  const reduced = usePrefersReducedMotion();
  const [t, setT] = React.useState<TiltState>(REST);
  const frame = React.useRef<number | null>(null);

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (reduced || e.pointerType !== "mouse") return;
      const r = e.currentTarget.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setT({
          rx: -ny * max * 0.75,
          ry: nx * max,
          gx: (nx + 0.5) * 100,
          gy: (ny + 0.5) * 100,
          on: true,
        });
      });
    },
    [reduced, max],
  );
  const onPointerLeave = React.useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setT(REST);
  }, []);

  React.useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const style: React.CSSProperties = reduced
    ? {}
    : {
        transform: `perspective(1000px) rotateX(${t.rx.toFixed(2)}deg) rotateY(${t.ry.toFixed(2)}deg)`,
        transition: t.on
          ? "transform 120ms ease-out, box-shadow 300ms ease"
          : "transform 700ms var(--ease-spring), box-shadow 300ms ease",
        boxShadow: t.on ? "0 22px 44px -18px oklch(0.2 0.04 255 / 0.35)" : undefined,
      };
  const glareStyle: React.CSSProperties = {
    background: `radial-gradient(360px circle at ${t.gx.toFixed(1)}% ${t.gy.toFixed(1)}%, color-mix(in oklch, var(--primary) 10%, transparent), transparent 62%)`,
    opacity: t.on ? 1 : 0,
    transition: "opacity 300ms ease",
  };

  return { handlers: { onPointerMove, onPointerLeave }, style, glareStyle, active: t.on };
}
