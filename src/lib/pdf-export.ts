import { toPng } from "html-to-image";
import jsPDF from "jspdf";

const LOGO_MAX_HEIGHT = 40; // pt — keep aspect ratio, never exceed this, never stretch
const PAGE_MARGIN = 24; // pt

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

/**
 * Exports the dashboard as a PDF by screenshotting the live DOM (via
 * html-to-image) and laying the resulting image into a jsPDF document,
 * paginated to fit page height. html-to-image renders through an SVG
 * <foreignObject>, so it reads the page's actual computed styles —
 * including CSS Color 4 oklch()/oklab() — directly through the browser's
 * own rendering, unlike html2canvas which re-implements CSS parsing and
 * chokes on oklch(). A small text/logo header is drawn on top in jsPDF
 * since that metadata isn't part of the on-screen dashboard itself.
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

  onProgress?.("Capturing dashboard…");
  const screenshotUrl = await toPng(container, {
    pixelRatio: 2,
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
    // Skip interactive page chrome (line tabs, date pickers, the export
    // button itself) marked with data-pdf-exclude — the PDF should capture
    // the dashboard's data cards, not the controls used to configure them.
    filter: (node) => !(node instanceof HTMLElement && node.dataset.pdfExclude === "true"),
  });
  const screenshot = await loadImage(screenshotUrl);

  onProgress?.("Building PDF…");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;

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

  // Scale the screenshot to the page's content width, then slice it into
  // page-height chunks (re-cropped through a canvas) so tall dashboards
  // span multiple PDF pages instead of being squashed onto one.
  const pxPerPt = screenshot.width / contentWidth;
  let sourceY = 0;
  let remainingPx = screenshot.height;
  let firstPage = true;

  while (remainingPx > 0) {
    const availableHeightPt = firstPage
      ? pageHeight - cursorY - PAGE_MARGIN
      : pageHeight - PAGE_MARGIN * 2;
    const availablePx = Math.floor(availableHeightPt * pxPerPt);
    const slicePx = Math.min(availablePx, remainingPx);

    const canvas = document.createElement("canvas");
    canvas.width = screenshot.width;
    canvas.height = slicePx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(
      screenshot,
      0,
      sourceY,
      screenshot.width,
      slicePx,
      0,
      0,
      screenshot.width,
      slicePx,
    );

    const sliceHeightPt = slicePx / pxPerPt;
    const y = firstPage ? cursorY : PAGE_MARGIN;
    doc.addImage(canvas.toDataURL("image/png"), "PNG", PAGE_MARGIN, y, contentWidth, sliceHeightPt);

    sourceY += slicePx;
    remainingPx -= slicePx;
    firstPage = false;
    if (remainingPx > 0) doc.addPage();
  }

  onProgress?.("Saving file…");
  const filename = `${dashboardName.replace(/[^a-z0-9]+/gi, "_")}_${lineName.replace(/[^a-z0-9]+/gi, "_")}_${from}_to_${to}.pdf`;
  doc.save(filename);
}
