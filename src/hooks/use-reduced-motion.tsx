import * as React from "react";

/**
 * Mirrors the CSS `prefers-reduced-motion: reduce` query into React state.
 *
 * The global rule in styles.css collapses every CSS animation and transition,
 * but Recharts tweens its marks in JavaScript — a requestAnimationFrame loop
 * that no stylesheet can reach. Charts have to be told separately, via
 * `isAnimationActive={!reduced}`.
 *
 * Starts false so the server render and the first client render agree
 * (matchMedia does not exist during SSR); the effect corrects it before paint
 * settles, and the only cost of being briefly wrong is one animation that was
 * already going to play.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
