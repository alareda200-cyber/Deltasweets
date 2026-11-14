import { useLook } from "@/lib/theme";

/**
 * The control room's look is the app's look now (Night / Day, src/lib/theme.ts):
 * true = Day. Kept as a hook so the Plant floor pages read the same as before.
 */
export function usePlantLook(): [boolean, () => void] {
  const [look, toggle] = useLook();
  return [look === "day", toggle];
}
