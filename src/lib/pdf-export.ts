import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const COMPANY_NAME = "Kandi Food Industries";
const PAGE_MARGIN = 36; // pt
const HEADER_HEIGHT = 46; // pt
const FOOTER_HEIGHT = 28; // pt
const LOGO_MAX_HEIGHT = 40; // pt — per spec: keep aspect ratio, never exceed this, never stretch

export interface PdfExportOptions {
  containerEl: HTMLElement;
  dashboardName: string;
  lineName: string;
  from: string;
  to: string;
  onProgress?: (message: string) => void;
}

interface LogoInfo {
  dataUrl: string;
  widthPt: number; // at LOGO_MAX_HEIGHT, aspect-ratio preserved
  heightPt: number;
}

// html2canvas ships its own CSS color parser, which does not understand
// CSS Color Level 4 functions like oklch() — used throughout this project's
// design tokens (src/styles.css) and directly in some chart gradients
// (DowntimeSection, MaintenanceDowntimeCard, ReworkSection).
//
// First attempt at this fix assumed getComputedStyle always normalizes
// colors down to rgb(). That's wrong on modern Chrome: when a color is
// authored as oklch(), getComputedStyle now serializes it back out as
// oklch() too (CSS Color 4 "used value" preserves the origin color space).
// So simply copying computed values around still copies oklch() strings
// verbatim — it never actually removed them.
//
// The real fix has two parts:
//  1. Convert any oklch() string found (via a real OKLCH->sRGB conversion,
//     not a browser API) into an rgb() string, applied both to individual
//     elements' inline styles/attributes AND
//  2. Rewrite the *stylesheet text* inside html2canvas's cloned document,
//     since html2canvas parses CSS rules directly from stylesheets, not
//     only from resolved element styles — this is the actual mechanism
//     that was still crashing after part 1 alone.
const OKLCH_REGEX = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/gi;
// oklab() gives L, a, b directly (no hue/chroma polar form) — a real,
// separate CSS Color 4 function distinct from oklch(). Confirmed this
// project's own CSS never authors oklab() directly (grepped styles.css —
// zero occurrences); it's the browser's own internal color serialization
// producing it during rendering, so it has to be handled here too.
const OKLAB_REGEX = /oklab\(\s*([\d.]+%?)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/gi;

function oklabToRgbString(L: number, a: number, b: number, A: number): string {
  // OKLab -> LMS (cube root space) -> LMS
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // LMS -> linear sRGB
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const toSrgb = (c: number) => {
    c = Math.max(0, Math.min(1, c));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  r = toSrgb(r);
  g = toSrgb(g);
  bl = toSrgb(bl);
  const toByte = (c: number) => Math.round(Math.max(0, Math.min(1, c)) * 255);
  return `rgba(${toByte(r)}, ${toByte(g)}, ${toByte(bl)}, ${Number.isFinite(A) ? A : 1})`;
}

function oklchToRgbString(
  match: string,
  lRaw: string,
  cRaw: string,
  hRaw: string,
  aRaw?: string,
): string {
  let L = parseFloat(lRaw);
  if (lRaw.includes("%")) L = L / 100;
  const C = parseFloat(cRaw);
  const Hdeg = parseFloat(hRaw);
  let A = aRaw != null ? parseFloat(aRaw) : 1;
  if (aRaw && aRaw.includes("%")) A = A / 100;

  const hRad = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  return oklabToRgbString(L, a, b, A);
}

function replaceOklch(text: string): string {
  if (!text) return text;
  let out = text;
  if (out.includes("oklch(")) {
    out = out.replace(OKLCH_REGEX, (m, l, c, h, a) => {
      try {
        return oklchToRgbString(m, l, c, h, a);
      } catch {
        return "rgb(128,128,128)"; // last-resort neutral fallback, never leave oklch() in place
      }
    });
  }
  if (out.includes("oklab(")) {
    out = out.replace(OKLAB_REGEX, (_m, lRaw, aRaw, bRaw, alphaRaw) => {
      try {
        let L = parseFloat(lRaw);
        if (lRaw.includes("%")) L = L / 100;
        let A = alphaRaw != null ? parseFloat(alphaRaw) : 1;
        if (alphaRaw && alphaRaw.includes("%")) A = A / 100;
        return oklabToRgbString(L, parseFloat(aRaw), parseFloat(bRaw), A);
      } catch {
        return "rgb(128,128,128)"; // last-resort neutral fallback, never leave oklab() in place
      }
    });
  }
  return out;
}

const COLOR_ATTR_PROPS = ["fill", "stroke", "stop-color", "flood-color", "lighting-color"] as const;

function hasModernColor(text: string): boolean {
  return text.includes("oklch(") || text.includes("oklab(");
}

// Part 1: per-element inline style/attribute conversion.
function flattenColorsIntoClone(liveRoot: Element, cloneRoot: Element) {
  const liveEls = [liveRoot, ...Array.from(liveRoot.querySelectorAll("*"))];
  const cloneEls = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll("*"))];
  const len = Math.min(liveEls.length, cloneEls.length);
  for (let i = 0; i < len; i++) {
    const live = liveEls[i];
    const clone = cloneEls[i] as HTMLElement | SVGElement;

    const styleAttr = live.getAttribute("style");
    if (styleAttr && hasModernColor(styleAttr)) {
      clone.setAttribute("style", replaceOklch(styleAttr));
    }
    if (live instanceof SVGElement) {
      for (const attr of COLOR_ATTR_PROPS) {
        const value = live.getAttribute(attr);
        if (value && hasModernColor(value)) {
          (clone as SVGElement).setAttribute(attr, replaceOklch(value));
        }
      }
    }
  }
}

// Part 2: rewrite every stylesheet's actual CSS text inside the cloned
// document. html2canvas resolves each cloned element's colors by calling
// window.getComputedStyle() on it (see CSSParsedDeclaration in html2canvas's
// own source) — so what determines whether box-shadow, custom-property-
// driven colors, etc. come out as oklch() or rgb() is the cascade actually
// in effect in the CLONED document, not the live page. This function makes
// that cascade oklch-free.
//
// Operates on raw stylesheet *text*, not the CSSOM, wherever possible:
//  - inline <style> elements: `element.textContent` is exactly what was
//    authored, so rewriting it in place can't reformat or drop rules the
//    way a CSSRule.cssText round-trip could.
//  - external <link rel="stylesheet">: by the time onclone runs, html2canvas
//    has already awaited the cloned iframe's load event, so the linked
//    sheet's CSSOM (cssRules) reliably reflects the real, browser-parsed
//    CSS — that's the primary path. fetch(link.href) is only a fallback for
//    when cssRules throws (cross-origin without CORS); it's deliberately
//    NOT the primary path, because dev servers like Vite serve a *different*
//    response body for the same URL depending on how it's requested — a
//    plain fetch() without an explicit `Accept: text/css` can come back as
//    a JS module wrapper (`import ... ; const __vite__css = "..."`) rather
//    than CSS text, which would silently turn the clone's <style> into
//    invalid CSS and wipe out every rule in it, not just the oklch ones.
// This covers every selector shape (:root, .dark, any class, any @-rule)
// because it rewrites the whole text rather than targeting specific rules
// — by build time Tailwind's @theme/@utility have already been compiled
// away into plain rules and custom properties, so there's nothing special
// left to single out.
async function rewriteStylesheetsInClone(doc: Document): Promise<void> {
  const sheets = Array.from(doc.styleSheets);
  await Promise.all(
    sheets.map(async (sheet) => {
      const owner = sheet.ownerNode;
      try {
        if (owner instanceof HTMLStyleElement) {
          const text = owner.textContent ?? "";
          if (hasModernColor(text)) owner.textContent = replaceOklch(text);
          return;
        }
        if (owner instanceof HTMLLinkElement) {
          await rewriteLinkedStylesheet(doc, owner, sheet);
          return;
        }
        // No owner node (e.g. a sheet with an inaccessible/unusual origin) —
        // fall back to a best-effort CSSOM read.
        const cssText = Array.from(sheet.cssRules ?? [])
          .map((r) => r.cssText)
          .join("\n");
        if (hasModernColor(cssText)) {
          const styleEl = doc.createElement("style");
          styleEl.textContent = replaceOklch(cssText);
          doc.head.appendChild(styleEl);
        }
      } catch {
        // Cross-origin or otherwise inaccessible stylesheet — skip it rather
        // than aborting the whole export.
      }
    }),
  );

  // Constructable stylesheets attached via document.adoptedStyleSheets don't
  // appear in doc.styleSheets at all — cover them separately.
  for (const sheet of doc.adoptedStyleSheets ?? []) {
    try {
      const cssText = Array.from(sheet.cssRules ?? [])
        .map((r) => r.cssText)
        .join("\n");
      if (hasModernColor(cssText)) sheet.replaceSync(replaceOklch(cssText));
    } catch {
      // Best-effort — skip.
    }
  }
}

async function rewriteLinkedStylesheet(
  doc: Document,
  link: HTMLLinkElement,
  sheet: CSSStyleSheet,
): Promise<void> {
  let cssText: string | null = null;
  try {
    cssText = Array.from(sheet.cssRules ?? [])
      .map((r) => r.cssText)
      .join("\n");
  } catch {
    // Cross-origin without CORS, or not yet parsed — fall through to fetch.
  }
  if (cssText == null) {
    try {
      const res = await fetch(link.href, { headers: { Accept: "text/css" } });
      const contentType = res.headers.get("content-type") ?? "";
      // Only trust the response if the server actually says it's CSS — some
      // dev servers return a JS module wrapper for the same URL otherwise,
      // and silently treating that as CSS would corrupt the whole sheet.
      if (res.ok && contentType.includes("css")) cssText = await res.text();
    } catch {
      // Network failure — nothing more we can do for this sheet.
    }
  }
  if (cssText == null || !hasModernColor(cssText)) return;
  const styleEl = doc.createElement("style");
  styleEl.textContent = replaceOklch(cssText);
  link.parentNode?.replaceChild(styleEl, link);
}

// Belt-and-suspenders pass, run last: ask the clone's own cascade — via
// getComputedStyle(), the exact same API html2canvas itself calls — whether
// any oklch()/oklab() is still resolving through for a given element (e.g.
// a custom property the stylesheet rewrite above genuinely couldn't reach).
// Where it finds one, it pins just that property inline with the converted
// value; elements with nothing left to fix are untouched.
const COMPUTED_COLOR_PROPS = [
  "box-shadow",
  "background-color",
  "background-image",
  "color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
] as const;

function guardResidualModernColor(cloneRoot: Element) {
  const view = cloneRoot.ownerDocument.defaultView;
  if (!view) return;
  const els = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll("*"))];
  for (const el of els) {
    if (!(el instanceof HTMLElement)) continue;
    const computed = view.getComputedStyle(el);
    const overrides: string[] = [];
    for (const prop of COMPUTED_COLOR_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value && hasModernColor(value)) {
        overrides.push(`${prop}: ${replaceOklch(value)} !important`);
      }
    }
    if (overrides.length > 0) {
      const existing = el.getAttribute("style") ?? "";
      el.setAttribute("style", `${existing};${overrides.join(";")}`);
    }
  }
}

// Loads /logo.png (served from the public/ folder) and computes the
// aspect-ratio-preserved dimensions capped at LOGO_MAX_HEIGHT. Never
// stretches or distorts — width is always derived from the image's own
// natural aspect ratio, not a fixed value.
async function loadLogo(): Promise<LogoInfo | null> {
  try {
    const res = await fetch("/logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const dims: { w: number; h: number } = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = reject;
      img.src = dataUrl;
    });
    const scale = dims.h > LOGO_MAX_HEIGHT ? LOGO_MAX_HEIGHT / dims.h : 1;
    return { dataUrl, widthPt: dims.w * scale, heightPt: dims.h * scale };
  } catch {
    // Logo is optional — export still proceeds without it if it can't be loaded.
    return null;
  }
}

/**
 * Captures every direct child of `containerEl` as its own high-resolution
 * image, then lays them out across A4 portrait pages — starting a new page
 * whenever the next card wouldn't fully fit, so no card/chart is ever cut
 * across a page break. A dedicated cover page comes first, followed by
 * content pages, each with the same header/footer + page number.
 */
export async function exportDashboardToPdf({
  containerEl,
  dashboardName,
  lineName,
  from,
  to,
  onProgress,
}: PdfExportOptions): Promise<void> {
  const sections = Array.from(containerEl.children) as HTMLElement[];
  if (sections.length === 0) throw new Error("Nothing to export — the dashboard is empty.");

  onProgress?.("Preparing PDF…");
  const logo = await loadLogo();

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const contentTop = PAGE_MARGIN + HEADER_HEIGHT;
  const contentBottom = pageHeight - PAGE_MARGIN - FOOTER_HEIGHT;
  const maxContentHeight = contentBottom - contentTop;
  const generatedAt = new Date();

  // --- Cover page ---
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, pageWidth, pageHeight, "F");
  let coverY = pageHeight / 2 - 120;
  if (logo) {
    const logoX = (pageWidth - logo.widthPt) / 2;
    pdf.addImage(
      logo.dataUrl,
      "PNG",
      logoX,
      coverY,
      logo.widthPt,
      logo.heightPt,
      undefined,
      "FAST",
    );
    coverY += logo.heightPt + 28;
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.setTextColor(20, 20, 20);
  pdf.text(COMPANY_NAME, pageWidth / 2, coverY, { align: "center" });
  coverY += 30;
  pdf.setFontSize(15);
  pdf.setTextColor(60, 60, 60);
  pdf.text(dashboardName, pageWidth / 2, coverY, { align: "center" });
  coverY += 34;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.setTextColor(90, 90, 90);
  pdf.text(`Production Line: ${lineName}`, pageWidth / 2, coverY, { align: "center" });
  coverY += 18;
  pdf.text(`Reporting Period: ${from} → ${to}`, pageWidth / 2, coverY, { align: "center" });
  coverY += 18;
  pdf.text(`Generated By: Production Scorecard System`, pageWidth / 2, coverY, { align: "center" });
  coverY += 18;
  pdf.text(`Generated: ${generatedAt.toLocaleString()}`, pageWidth / 2, coverY, {
    align: "center",
  });

  // Render each section to a canvas up front (sequential, not parallel, to
  // keep peak memory reasonable on large dashboards).
  const images: { dataUrl: string; widthPt: number; heightPt: number }[] = [];
  for (let i = 0; i < sections.length; i++) {
    onProgress?.(`Rendering section ${i + 1} of ${sections.length}…`);
    const sourceEl = sections[i];
    const canvas = await html2canvas(sourceEl, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      onclone: async (doc, clonedEl) => {
        try {
          await rewriteStylesheetsInClone(doc);
        } catch {
          // Best-effort — proceed even if some stylesheet couldn't be rewritten.
        }
        try {
          flattenColorsIntoClone(sourceEl, clonedEl);
        } catch {
          // Best-effort: if flattening fails for any element, proceed with
          // whatever was already converted rather than aborting the export.
        }
        try {
          guardResidualModernColor(clonedEl);
        } catch {
          // Best-effort — final safety net; proceed regardless.
        }
      },
    });
    let widthPt = contentWidth;
    let heightPt = (canvas.height / canvas.width) * widthPt;
    // If a single section is still taller than one full page's content area
    // even at full page width, scale it down further so it fits on one page
    // rather than ever being cut across a page break.
    if (heightPt > maxContentHeight) {
      const scale = maxContentHeight / heightPt;
      heightPt = maxContentHeight;
      widthPt = widthPt * scale;
    }
    images.push({ dataUrl: canvas.toDataURL("image/png"), widthPt, heightPt });
  }

  onProgress?.("Laying out pages…");

  function drawHeader() {
    if (logo) {
      pdf.addImage(
        logo.dataUrl,
        "PNG",
        PAGE_MARGIN,
        PAGE_MARGIN,
        logo.widthPt,
        logo.heightPt,
        undefined,
        "FAST",
      );
    }
    const textX = PAGE_MARGIN + (logo ? logo.widthPt + 10 : 0);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(20, 20, 20);
    pdf.text(COMPANY_NAME, textX, PAGE_MARGIN + 14);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(90, 90, 90);
    pdf.text(dashboardName, textX, PAGE_MARGIN + 30);
    pdf.setFontSize(9);
    const rightText = `Line: ${lineName}   |   Period: ${from} → ${to}`;
    pdf.text(rightText, pageWidth - PAGE_MARGIN, PAGE_MARGIN + 14, { align: "right" });
    pdf.text(
      `Generated By: Production Scorecard System`,
      pageWidth - PAGE_MARGIN,
      PAGE_MARGIN + 28,
      { align: "right" },
    );
    pdf.setDrawColor(220, 220, 220);
    pdf.line(PAGE_MARGIN, contentTop - 8, pageWidth - PAGE_MARGIN, contentTop - 8);
  }

  function drawFooter(pageNum: number, totalPages: number) {
    pdf.setDrawColor(220, 220, 220);
    pdf.line(PAGE_MARGIN, contentBottom + 8, pageWidth - PAGE_MARGIN, contentBottom + 8);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(120, 120, 120);
    pdf.text(
      `Generated ${generatedAt.toLocaleString()}`,
      PAGE_MARGIN,
      pageHeight - PAGE_MARGIN + 12,
    );
    pdf.text(
      `Page ${pageNum} of ${totalPages}`,
      pageWidth - PAGE_MARGIN,
      pageHeight - PAGE_MARGIN + 12,
      { align: "right" },
    );
  }

  // Content pages start after the cover page.
  pdf.addPage();
  let cursorY = contentTop;
  drawHeader();

  for (const img of images) {
    const gap = 14;
    if (cursorY + img.heightPt > contentBottom && cursorY > contentTop) {
      pdf.addPage();
      cursorY = contentTop;
      drawHeader();
    }
    const x = PAGE_MARGIN + (contentWidth - img.widthPt) / 2;
    pdf.addImage(img.dataUrl, "PNG", x, cursorY, img.widthPt, img.heightPt, undefined, "FAST");
    cursorY += img.heightPt + gap;
  }

  // Stamp footers with the correct "Page X of Y" now that the total page
  // count is known. The cover page (page 1) intentionally has no footer —
  // it's a title page, not a content page.
  const totalPages = pdf.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    pdf.setPage(p);
    drawFooter(p - 1, totalPages - 1);
  }

  onProgress?.("Saving file…");
  const filename = `${dashboardName.replace(/[^a-z0-9]+/gi, "_")}_${lineName.replace(/[^a-z0-9]+/gi, "_")}_${from}_to_${to}.pdf`;
  pdf.save(filename);
}
