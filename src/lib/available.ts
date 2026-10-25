// A shift is 480 minutes and a full day 1,440 (Ala, 25 Oct 2026). Shift
// entries saved with 1,440 (the old form default) made a Marshmallows shift
// look able to make 3,000 kg, so Performance read 27% instead of 73%. The
// figures count a shift entry's available time at most 480 minutes.
export const SHIFT_MAX_MIN = 480;
export const DAY_MAX_MIN = 1440;

export const maxAvailableMin = (shift: string | null | undefined) =>
  shift && shift !== "DAY" ? SHIFT_MAX_MIN : DAY_MAX_MIN;

export function entryAvailableMin(e: { shift?: string | null; available_min: number | null }) {
  return Math.min(Number(e.available_min) || 0, maxAvailableMin(e.shift));
}
