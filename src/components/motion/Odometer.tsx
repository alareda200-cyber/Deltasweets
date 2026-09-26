import * as React from "react";

import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export interface OdometerProps {
  /** null shows a dash. */
  value: number | null;
  decimals?: number;
  /** Appended after the number, e.g. "%". */
  suffix?: string;
  /** Thousands separators (1,234). */
  grouping?: boolean;
  /** Roll up from 0 on first mount. */
  fromZero?: boolean;
  /** Extra delay before the first roll, ms. */
  delay?: number;
  className?: string;
  /** Read by screen readers instead of the rolling digits. */
  label?: string;
}

function formatValue(v: number, decimals: number, grouping: boolean) {
  return Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  });
}

/**
 * A number whose digits roll like a counter — says "this number changed, and
 * by how much". Each digit is its own column; the right-most rolls first.
 * Columns are keyed from the right, so 99.9 → 100.0 adds a column on the left
 * without re-mounting the others. Screen readers get the plain value.
 */
export function Odometer({
  value,
  decimals = 1,
  suffix = "",
  grouping = false,
  fromZero = true,
  delay = 0,
  className,
  label,
}: OdometerProps) {
  const reduced = usePrefersReducedMotion();
  const [armed, setArmed] = React.useState(!fromZero);

  React.useEffect(() => {
    if (armed) return;
    const t = setTimeout(() => setArmed(true), 60 + delay);
    return () => clearTimeout(t);
  }, [armed, delay]);

  const sign = value != null && value < 0 ? "-" : "";
  const digits = value == null ? "" : formatValue(value, decimals, grouping);
  const text = value == null ? "—" : sign + digits;
  // Before the first roll every digit sits at 0 in the final layout (same
  // separators, same width) — the sign is not padded into a digit column.
  const shown =
    value == null ? "—" : armed || reduced ? text : sign + digits.replace(/[0-9]/g, "0");
  const chars = shown.split("");
  // No value: a plain dash, without the unit ("—", not "—%").
  const unit = value == null ? "" : suffix;

  return (
    <span
      className={cn(
        "relative inline-flex h-[1em] items-start leading-none tabular-nums",
        className,
      )}
    >
      <span className="sr-only">{label ?? text + unit}</span>
      <span
        aria-hidden="true"
        className="inline-flex h-[1em] items-start overflow-hidden leading-none"
      >
        {chars.map((ch, i) => {
          const key = chars.length - i;
          if (!/[0-9]/.test(ch)) {
            return (
              <span key={"s" + key} className="inline-block h-[1em] leading-none">
                {ch}
              </span>
            );
          }
          const fromRight = chars.filter((c, j) => j > i && /[0-9]/.test(c)).length;
          return (
            <span
              key={"d" + key}
              className="inline-block h-[1em] w-[0.6em] overflow-hidden text-center leading-none"
            >
              <span
                className="flex flex-col"
                style={{
                  transform: `translateY(-${Number(ch) * 10}%)`,
                  transition: reduced
                    ? undefined
                    : `transform 900ms cubic-bezier(.34,1.3,.64,1) ${fromRight * 70}ms`,
                }}
              >
                {DIGITS.map((d) => (
                  <span key={d} className="block h-[1em] leading-none">
                    {d}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
        {unit ? <span className="inline-block h-[1em] leading-none">{unit}</span> : null}
      </span>
    </span>
  );
}
