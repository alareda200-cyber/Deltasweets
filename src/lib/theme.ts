// The app's two looks (Control Room design, approved 10 Nov 2026): Night (the
// default, the `.dark` class) and Day. The choice is kept on this device. An
// inline script in the document head (src/routes/__root.tsx, THEME_BOOT) sets
// the class before the first paint, so a page never flashes the other look.
import { useEffect, useState } from "react";

export type Look = "night" | "day";
export const THEME_KEY = "ds-theme";
const BAR = { night: "#070b17", day: "#eef2fc" } as const;

export const THEME_BOOT = `(function(){try{var d=localStorage.getItem("${THEME_KEY}")!=="day";var e=document.documentElement;e.classList.toggle("dark",d);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"${BAR.night}":"${BAR.day}")}catch(_){document.documentElement.classList.add("dark")}})();`;

/** The saved look; Night when nothing is saved. */
export function storedLook(): Look {
  try {
    return localStorage.getItem(THEME_KEY) === "day" ? "day" : "night";
  } catch {
    return "night";
  }
}

/**
 * Puts the saved look back on <html>. React renders <html> itself when the
 * app starts and drops the class the head script set, so the root calls this
 * in a layout effect: after that render, before the browser paints.
 */
export function applyStoredLook() {
  const look = storedLook();
  document.documentElement.classList.toggle("dark", look === "night");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[look]);
}

function current(): Look {
  if (typeof document === "undefined") return "night";
  return document.documentElement.classList.contains("dark") ? "night" : "day";
}

export function setLook(look: Look) {
  document.documentElement.classList.toggle("dark", look === "night");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[look]);
  try {
    localStorage.setItem(THEME_KEY, look);
  } catch {
    /* not remembered: private mode */
  }
}

/** The current look, following any change made anywhere on the page. */
export function useLook(): [Look, () => void] {
  const [look, setState] = useState<Look>("night");
  useEffect(() => {
    setState(current());
    const mo = new MutationObserver(() => setState(current()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return [look, () => setLook(current() === "night" ? "day" : "night")];
}

/**
 * Reports are printed in the classic light palette whatever the look on
 * screen: data-print on the captured element restores the old light tokens
 * for it and everything inside (src/styles.css) until the returned function
 * is called. The rest of the page keeps its look.
 */
export function printLook(el: HTMLElement): () => void {
  el.dataset.print = "true";
  return () => {
    delete el.dataset.print;
  };
}
