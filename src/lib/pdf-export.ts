import { toJpeg } from "html-to-image";
import jsPDF from "jspdf";

const LOGO_MAX_HEIGHT = 40; // pt — keep aspect ratio, never exceed this, never stretch
const PAGE_MARGIN = 24; // pt
const SECTION_GAP = 12; // pt — vertical space between sections stacked on the same page
const JPEG_QUALITY = 0.8;
const CAPTURE_PIXEL_RATIO = 1.5;
// Forced during capture so a phone/tablet export renders the same desktop
// layout (chart proportions, card padding) as a desktop export — html-to-image
// reads the DOM's actual layout size, which otherwise reflects whatever
// narrow viewport the exporting device happens to have.
const DESKTOP_CAPTURE_WIDTH = 1280; // px

export interface PdfExportOptions {
  container: HTMLElement;
  dashboardName: string;
  lineName: string;
  from: string;
  to: string;
  onProgress?: (message: string) => void;
}

interface LogoInfo {
  dataUrl: string;
  widthPt: number;
  heightPt: number;
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
    const img = await loadImage(dataUrl);
    const scale = img.height > LOGO_MAX_HEIGHT ? LOGO_MAX_HEIGHT / img.height : 1;
    return { dataUrl, widthPt: img.width * scale, heightPt: img.height * scale };
  } catch {
    // Logo is optional — export still proceeds without it if it can't be loaded.
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Skip interactive page chrome (line tabs, date pickers, the export button
// itself) marked with data-pdf-exclude — the PDF should capture the
// dashboard's data cards, not the controls used to configure them.
function excludeFilter(node: Node): boolean {
  return !(node instanceof HTMLElement && node.dataset.pdfExclude === "true");
}

/**
 * Draws a single already-captured section image into the PDF, splitting it
 * across pages by raw pixel slices. Only used as a fallback for a section
 * that is itself taller than one full A4 page — there's no way to avoid a
 * page break somewhere inside it, but it always starts on a fresh page so no
 * *other* section ever shares that break.
 */
function drawOversizedSection(
  doc: jsPDF,
  img: HTMLImageElement,
  contentWidth: number,
  maxContentHeight: number,
  pxPerPt: number,
): void {
  let sourceY = 0;
  let remainingPx = img.height;
  let firstSlice = true;

  while (remainingPx > 0) {
    const availablePx = Math.floor(maxContentHeight * pxPerPt);
    const slicePx = Math.min(availablePx, remainingPx);

    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = slicePx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(img, 0, sourceY, img.width, slicePx, 0, 0, img.width, slicePx);

    const sliceHeightPt = slicePx / pxPerPt;
    if (!firstSlice) doc.addPage();
    doc.addImage(
      canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      "JPEG",
      PAGE_MARGIN,
      PAGE_MARGIN,
      contentWidth,
      sliceHeightPt,
      undefined,
      "FAST",
    );

    sourceY += slicePx;
    remainingPx -= slicePx;
    firstSlice = false;
  }
}

/**
 * Exports the dashboard as a PDF by screenshotting each `[data-pdf-section]`
 * element separately (via html-to-image) and laying each one into a jsPDF
 * document as an indivisible unit — a section either fits fully in the
 * remaining space on the current page, or starts a fresh page, but is never
 * cut in half the way a single whole-dashboard screenshot would be sliced by
 * raw pixel height. html-to-image renders through an SVG <foreignObject>, so
 * it reads the page's actual computed styles — including CSS Color 4
 * oklch()/oklab() — directly through the browser's own rendering, unlike
 * html2canvas which re-implements CSS parsing and chokes on oklch(). A small
 * text/logo header is drawn on top in jsPDF since that metadata isn't part
 * of the on-screen dashboard itself.
 */
export async function exportDashboardToPdf({
  container,
  dashboardName,
  lineName,
  from,
  to,
  onProgress,
}: PdfExportOptions): Promise<void> {
  onProgress?.("Preparing PDF…");
  const logo = await loadLogo();
  const generatedAt = new Date();

  const sectionEls = Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-section]"));
  if (sectionEls.length === 0) {
    throw new Error("Nothing to export — no dashboard sections found.");
  }

  const originalWidth = container.style.width;
  const originalMaxWidth = container.style.maxWidth;
  container.style.width = `${DESKTOP_CAPTURE_WIDTH}px`;
  container.style.maxWidth = "none";

  try {
    const backgroundColor = getComputedStyle(document.body).backgroundColor || "#ffffff";
    const captured: HTMLImageElement[] = [];
    for (let i = 0; i < sectionEls.length; i++) {
      onProgress?.(`Capturing section ${i + 1} of ${sectionEls.length}…`);
      const dataUrl = await toJpeg(sectionEls[i], {
        quality: JPEG_QUALITY,
        pixelRatio: CAPTURE_PIXEL_RATIO,
        backgroundColor,
        filter: excludeFilter,
      });
      captured.push(await loadImage(dataUrl));
    }

    onProgress?.("Building PDF…");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - PAGE_MARGIN * 2;
    const maxContentHeight = pageHeight - PAGE_MARGIN * 2;

    let cursorY = PAGE_MARGIN;
    if (logo) {
      doc.addImage(logo.dataUrl, "PNG", PAGE_MARGIN, cursorY, logo.widthPt, logo.heightPt);
    }
    const textX = PAGE_MARGIN + (logo?.widthPt ?? 0) + (logo ? 12 : 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(dashboardName, textX, cursorY + 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`${lineName} · ${from} → ${to}`, textX, cursorY + 30);
    doc.text(`Generated ${generatedAt.toLocaleString()}`, textX, cursorY + 44);
    cursorY += Math.max(logo?.heightPt ?? 0, 48) + 16;

    for (const img of captured) {
      const pxPerPt = img.width / contentWidth;
      const sectionHeightPt = img.height / pxPerPt;

      if (sectionHeightPt <= maxContentHeight) {
        // Whole section fits on one page as a single unit — start a fresh
        // page rather than splitting it across the current one.
        if (cursorY + sectionHeightPt > pageHeight - PAGE_MARGIN) {
          doc.addPage();
          cursorY = PAGE_MARGIN;
        }
        doc.addImage(
          img.src,
          "JPEG",
          PAGE_MARGIN,
          cursorY,
          contentWidth,
          sectionHeightPt,
          undefined,
          "FAST",
        );
        cursorY += sectionHeightPt + SECTION_GAP;
      } else {
        // Taller than a full page — give it a dedicated fresh page (no other
        // section shares this break) and slice only within it.
        if (cursorY > PAGE_MARGIN) {
          doc.addPage();
        }
        drawOversizedSection(doc, img, contentWidth, maxContentHeight, pxPerPt);
        cursorY = pageHeight; // next section (if any) always starts a new page
      }
    }

    onProgress?.("Saving file…");
    const filename = `${dashboardName.replace(/[^a-z0-9]+/gi, "_")}_${lineName.replace(/[^a-z0-9]+/gi, "_")}_${from}_to_${to}.pdf`;
    doc.save(filename);
  } finally {
    container.style.width = originalWidth;
    container.style.maxWidth = originalMaxWidth;
  }
}
