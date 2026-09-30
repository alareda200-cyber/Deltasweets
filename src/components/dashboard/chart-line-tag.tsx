// A dashed reference line's name, drawn on a small card-coloured plate so the
// bars never cover it. Recharts hands a label its line's viewBox; the plate
// sits just above the line at the left edge of the plot.
export function lineTag(text: string, color: string) {
  return function LineTag(props: { viewBox?: { x?: number; y?: number } }) {
    const x = (props.viewBox?.x ?? 0) + 4;
    const y = props.viewBox?.y ?? 0;
    const w = Math.round(text.length * 6.4) + 10;
    return (
      <g data-line-tag="" pointerEvents="none">
        <rect
          x={x}
          y={y - 19}
          width={w}
          height={16}
          rx={4}
          fill="var(--color-card)"
          fillOpacity={0.92}
        />
        <text x={x + 5} y={y - 7} fontSize={11} fontWeight={700} fill={color}>
          {text}
        </text>
      </g>
    );
  };
}

/** Axis numbers that fit 44px: 950, 1k, 1.5k, 12k. */
export function compactTick(v: number): string {
  if (Math.abs(v) < 1000) return String(v);
  const k = v / 1000;
  return `${Number.isInteger(k) ? k : Math.round(k * 10) / 10}k`;
}
