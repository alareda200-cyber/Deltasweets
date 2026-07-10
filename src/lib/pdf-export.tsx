import { pdf } from "@react-pdf/renderer";
import { PdfDocument, type LogoInfo } from "@/lib/pdf-document";
import type { DailyEntry, EntryDowntime } from "@/lib/queries";

const LOGO_MAX_HEIGHT = 40; // pt — keep aspect ratio, never exceed this, never stretch

export interface PdfExportOptions {
  dashboardName: string;
  lineName: string;
  from: string;
  to: string;
  entries: DailyEntry[];
  downtimes: EntryDowntime[];
  onProgress?: (message: string) => void;
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
 * Builds the dashboard PDF directly from data — KPI summaries, a downtime
 * pareto table, and a daily entries table — via @react-pdf/renderer's own
 * layout engine, rather than screenshotting the live DOM with html2canvas.
 * This sidesteps html2canvas's lack of CSS Color 4 (oklch()/oklab()) support
 * entirely: @react-pdf/renderer never touches the page's CSS at all, so
 * there is no color space to convert. See git history on this file for the
 * screenshot-based approach this replaced and why it kept failing in
 * production.
 */
export async function exportDashboardToPdf({
  dashboardName,
  lineName,
  from,
  to,
  entries,
  downtimes,
  onProgress,
}: PdfExportOptions): Promise<void> {
  if (entries.length === 0)
    throw new Error("Nothing to export — there are no entries in this period.");

  onProgress?.("Preparing PDF…");
  const logo = await loadLogo();
  const generatedAt = new Date();

  onProgress?.("Rendering document…");
  const blob = await pdf(
    <PdfDocument
      dashboardName={dashboardName}
      lineName={lineName}
      from={from}
      to={to}
      generatedAt={generatedAt}
      logo={logo}
      entries={entries}
      downtimes={downtimes}
    />,
  ).toBlob();

  onProgress?.("Saving file…");
  const filename = `${dashboardName.replace(/[^a-z0-9]+/gi, "_")}_${lineName.replace(/[^a-z0-9]+/gi, "_")}_${from}_to_${to}.pdf`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
