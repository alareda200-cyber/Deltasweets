import { useEffect, useState } from "react";

const KEY = "pf-look";

/**
 * The control room's own look: night by default, day on request, remembered
 * on this device for every Plant floor page.
 */
export function usePlantLook(): [boolean, () => void] {
  const [day, setDay] = useState(false);
  useEffect(() => {
    try {
      setDay(window.localStorage.getItem(KEY) === "day");
    } catch {
      /* private mode: stay on night */
    }
  }, []);
  const toggle = () =>
    setDay((d) => {
      try {
        window.localStorage.setItem(KEY, d ? "night" : "day");
      } catch {
        /* not remembered */
      }
      return !d;
    });
  return [day, toggle];
}
