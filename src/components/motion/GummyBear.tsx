/** A gummy bear drawn around (0,0), about 26 units tall. Fill comes from the parent <g>. */
export function GummyBearShape() {
  return (
    <>
      <circle cx="-5.5" cy="-12" r="3.6" />
      <circle cx="5.5" cy="-12" r="3.6" />
      <circle cx="0" cy="-6.5" r="7" />
      <ellipse cx="0" cy="5.5" rx="7.5" ry="8.5" />
      <circle cx="-7.5" cy="1" r="3.2" />
      <circle cx="7.5" cy="1" r="3.2" />
      <circle cx="-4.8" cy="13" r="3.6" />
      <circle cx="4.8" cy="13" r="3.6" />
      <ellipse cx="-2.6" cy="-8.8" rx="2" ry="1.3" fill="white" opacity="0.6" />
    </>
  );
}

export const CANDY = [
  "var(--candy-1)",
  "var(--candy-2)",
  "var(--candy-3)",
  "var(--candy-4)",
  "var(--candy-5)",
  "var(--candy-6)",
  "var(--candy-7)",
];
