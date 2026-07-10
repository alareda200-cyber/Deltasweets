import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { DailyEntry, EntryDowntime } from "@/lib/queries";
import { fmt, pct } from "@/lib/date-utils";

const COMPANY_NAME = "Kandi Food Industries";

// Plain hex approximations of this project's oklch design tokens
// (src/styles.css --primary/--success/--warning/--destructive) — @react-pdf/renderer
// renders with its own layout engine, not a browser, so it never sees CSS at
// all and there is no oklch() to convert here (unlike the old html2canvas
// screenshot approach in git history).
const COLORS = {
  text: "#18181b",
  muted: "#6b7280",
  border: "#e2e2e6",
  headerBg: "#f6f6f8",
  primary: "#362f78",
  success: "#1f9d55",
  warning: "#c98a1a",
  danger: "#d1391f",
} as const;

type Variant = "default" | "primary" | "success" | "warning" | "danger";

const VARIANT_COLOR: Record<Variant, string> = {
  default: COLORS.text,
  primary: COLORS.primary,
  success: COLORS.success,
  warning: COLORS.warning,
  danger: COLORS.danger,
};

const styles = StyleSheet.create({
  coverPage: {
    paddingHorizontal: 60,
    paddingVertical: 0,
    fontFamily: "Helvetica",
    alignItems: "center",
    justifyContent: "center",
  },
  coverLogo: { marginBottom: 24 },
  coverCompany: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: COLORS.text,
    textAlign: "center",
  },
  coverTitle: { marginTop: 8, fontSize: 15, color: "#3c3c3c", textAlign: "center" },
  coverMeta: { marginTop: 10, fontSize: 11, color: COLORS.muted, textAlign: "center" },

  page: {
    paddingTop: 92,
    paddingBottom: 44,
    paddingHorizontal: 36,
    fontSize: 9,
    color: COLORS.text,
    fontFamily: "Helvetica",
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 76,
    paddingHorizontal: 36,
    paddingTop: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: `1pt solid ${COLORS.border}`,
  },
  headerLogo: { marginRight: 10 },
  headerCompany: { fontSize: 13, fontFamily: "Helvetica-Bold", color: COLORS.text },
  headerDashboard: { marginTop: 3, fontSize: 9, color: COLORS.muted },
  headerRight: { alignItems: "flex-end" },
  headerMeta: { fontSize: 8.5, color: COLORS.muted },

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 28,
    paddingHorizontal: 36,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: `1pt solid ${COLORS.border}`,
    fontSize: 8,
    color: COLORS.muted,
  },

  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 3,
  },
  sectionSubtitle: { fontSize: 8.5, color: COLORS.muted, marginBottom: 8 },

  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard: {
    flexGrow: 1,
    minWidth: 105,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  kpiLabel: { fontSize: 7.5, color: COLORS.muted, textTransform: "uppercase" },
  kpiValue: { marginTop: 4, fontSize: 14, fontFamily: "Helvetica-Bold" },

  table: { marginTop: 4, borderWidth: 1, borderColor: COLORS.border, borderRadius: 4 },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: COLORS.headerBg,
    borderBottom: `1pt solid ${COLORS.border}`,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: `0.5pt solid ${COLORS.border}`,
  },
  tableRowLast: { flexDirection: "row" },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.muted,
    paddingVertical: 5,
    paddingHorizontal: 6,
    textTransform: "uppercase",
  },
  tableCell: { fontSize: 8.5, paddingVertical: 4, paddingHorizontal: 6 },
  emptyNote: {
    marginTop: 4,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: "dashed",
    borderRadius: 4,
    fontSize: 8.5,
    color: COLORS.muted,
    textAlign: "center",
  },
});

export interface LogoInfo {
  dataUrl: string;
  widthPt: number;
  heightPt: number;
}

export interface KpiItem {
  label: string;
  value: string;
  variant?: Variant;
}

interface PerformanceTotals {
  plan: number;
  actual: number;
  variance: number;
  adherence: number;
}

function computePerformance(entries: DailyEntry[], field: "making" | "packing"): PerformanceTotals {
  const planKey = field === "making" ? "making_plan" : "packing_plan";
  const actualKey = field === "making" ? "making_actual" : "packing_actual";
  const plan = entries.reduce((s, e) => s + Number(e[planKey]), 0);
  const actual = entries.reduce((s, e) => s + Number(e[actualKey]), 0);
  const variance = actual - plan;
  const adherence = plan > 0 ? actual / plan : 0;
  return { plan, actual, variance, adherence };
}

function performanceKpis(title: string, totals: PerformanceTotals): KpiItem[] {
  return [
    { label: `${title} Plan (kg)`, value: fmt(totals.plan), variant: "primary" },
    { label: `${title} Actual (kg)`, value: fmt(totals.actual), variant: "primary" },
    {
      label: `${title} Variance`,
      value: fmt(totals.variance),
      variant: totals.variance >= 0 ? "success" : "danger",
    },
    {
      label: `${title} Adherence`,
      value: pct(totals.adherence),
      variant: totals.adherence >= 0.9 ? "success" : totals.adherence >= 0.7 ? "warning" : "danger",
    },
  ];
}

interface ParetoRow {
  reason: string;
  area: string;
  minutes: number;
  sharePct: number;
}

function computeDowntime(entries: DailyEntry[], downtimes: EntryDowntime[]) {
  const totalAvail = entries.reduce((s, e) => s + Number(e.available_min), 0);
  const totalDown = entries.reduce((s, e) => s + Number(e.downtime_min), 0);
  const lossPct = totalAvail > 0 ? (totalDown / totalAvail) * 100 : 0;

  const byReason = new Map<string, { reason: string; area: string; minutes: number }>();
  for (const d of downtimes) {
    const key = `${d.reason_name} | ${d.area}`;
    const cur = byReason.get(key);
    if (cur) cur.minutes += Number(d.minutes);
    else byReason.set(key, { reason: d.reason_name, area: d.area, minutes: Number(d.minutes) });
  }
  const sorted = Array.from(byReason.values()).sort((a, b) => b.minutes - a.minutes);
  const total = sorted.reduce((s, r) => s + r.minutes, 0);
  const rows: ParetoRow[] = sorted.map((r) => ({
    reason: r.reason,
    area: r.area,
    minutes: r.minutes,
    sharePct: total > 0 ? Math.round((r.minutes / total) * 1000) / 10 : 0,
  }));

  return { totalAvail, totalDown, lossPct, rows };
}

function computeRework(entries: DailyEntry[]) {
  const cooking = entries.reduce((s, e) => s + Number(e.rework_cooking), 0);
  const making = entries.reduce((s, e) => s + Number(e.rework_making), 0);
  const packing = entries.reduce((s, e) => s + Number(e.rework_packing), 0);
  const total = cooking + making + packing;
  const actual = entries.reduce((s, e) => s + Number(e.making_actual), 0);
  const reworkPct = actual > 0 ? (total / actual) * 100 : 0;
  return { cooking, making, packing, total, reworkPct };
}

function KpiRow({ items }: { items: KpiItem[] }) {
  return (
    <View style={styles.kpiRow}>
      {items.map((item) => (
        <View key={item.label} style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>{item.label}</Text>
          <Text style={[styles.kpiValue, { color: VARIANT_COLOR[item.variant ?? "default"] }]}>
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </>
  );
}

function ParetoTable({ rows }: { rows: ParetoRow[] }) {
  if (rows.length === 0) {
    return <Text style={styles.emptyNote}>No downtime reasons logged in this period.</Text>;
  }
  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow} fixed={false}>
        <Text style={[styles.tableHeaderCell, { width: "38%" }]}>Reason</Text>
        <Text style={[styles.tableHeaderCell, { width: "22%" }]}>Area</Text>
        <Text style={[styles.tableHeaderCell, { width: "20%", textAlign: "right" }]}>Minutes</Text>
        <Text style={[styles.tableHeaderCell, { width: "20%", textAlign: "right" }]}>Share</Text>
      </View>
      {rows.map((r, i) => (
        <View
          key={`${r.reason}-${r.area}-${i}`}
          style={i === rows.length - 1 ? styles.tableRowLast : styles.tableRow}
          wrap={false}
        >
          <Text style={[styles.tableCell, { width: "38%" }]}>{r.reason}</Text>
          <Text style={[styles.tableCell, { width: "22%" }]}>{r.area}</Text>
          <Text style={[styles.tableCell, { width: "20%", textAlign: "right" }]}>
            {fmt(r.minutes)}
          </Text>
          <Text style={[styles.tableCell, { width: "20%", textAlign: "right" }]}>
            {r.sharePct}%
          </Text>
        </View>
      ))}
    </View>
  );
}

function EntriesTable({ entries }: { entries: DailyEntry[] }) {
  if (entries.length === 0) {
    return <Text style={styles.emptyNote}>No entries in this period.</Text>;
  }
  const cols = [
    { key: "date", label: "Date", width: "13%" },
    { key: "shift", label: "Shift", width: "10%" },
    { key: "makingPlan", label: "Making Plan", width: "13%" },
    { key: "makingActual", label: "Making Actual", width: "14%" },
    { key: "packingPlan", label: "Packing Plan", width: "13%" },
    { key: "packingActual", label: "Packing Actual", width: "14%" },
    { key: "downtime", label: "Downtime (min)", width: "12%" },
    { key: "rework", label: "Rework (kg)", width: "11%" },
  ] as const;

  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        {cols.map((c) => (
          <Text
            key={c.key}
            style={[
              styles.tableHeaderCell,
              {
                width: c.width,
                textAlign: c.key === "date" || c.key === "shift" ? "left" : "right",
              },
            ]}
          >
            {c.label}
          </Text>
        ))}
      </View>
      {entries.map((e, i) => {
        const rework =
          Number(e.rework_cooking) + Number(e.rework_making) + Number(e.rework_packing);
        const cells: Record<(typeof cols)[number]["key"], string> = {
          date: e.entry_date,
          shift: e.shift,
          makingPlan: fmt(Number(e.making_plan)),
          makingActual: fmt(Number(e.making_actual)),
          packingPlan: fmt(Number(e.packing_plan)),
          packingActual: fmt(Number(e.packing_actual)),
          downtime: fmt(Number(e.downtime_min)),
          rework: fmt(rework),
        };
        return (
          <View
            key={e.id}
            style={i === entries.length - 1 ? styles.tableRowLast : styles.tableRow}
            wrap={false}
          >
            {cols.map((c) => (
              <Text
                key={c.key}
                style={[
                  styles.tableCell,
                  {
                    width: c.width,
                    textAlign: c.key === "date" || c.key === "shift" ? "left" : "right",
                  },
                ]}
              >
                {cells[c.key]}
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

export interface PdfDocumentProps {
  dashboardName: string;
  lineName: string;
  from: string;
  to: string;
  generatedAt: Date;
  logo: LogoInfo | null;
  entries: DailyEntry[];
  downtimes: EntryDowntime[];
}

export function PdfDocument({
  dashboardName,
  lineName,
  from,
  to,
  generatedAt,
  logo,
  entries,
  downtimes,
}: PdfDocumentProps) {
  const making = computePerformance(entries, "making");
  const packing = computePerformance(entries, "packing");
  const downtimeTotals = computeDowntime(entries, downtimes);
  const rework = computeRework(entries);

  const downtimeKpis: KpiItem[] = [
    { label: "Total Available (min)", value: fmt(downtimeTotals.totalAvail), variant: "primary" },
    { label: "Total Downtime (min)", value: fmt(downtimeTotals.totalDown), variant: "warning" },
    {
      label: "Loss %",
      value: `${downtimeTotals.lossPct.toFixed(1)}%`,
      variant:
        downtimeTotals.lossPct < 10
          ? "success"
          : downtimeTotals.lossPct < 25
            ? "warning"
            : "danger",
    },
  ];

  const reworkKpis: KpiItem[] = [
    { label: "Cooking (kg)", value: fmt(rework.cooking), variant: "primary" },
    { label: "Making (kg)", value: fmt(rework.making), variant: "primary" },
    { label: "Packing (kg)", value: fmt(rework.packing), variant: "primary" },
    { label: "Total (kg)", value: fmt(rework.total), variant: "primary" },
    {
      label: "% of Output",
      value: `${rework.reworkPct.toFixed(1)}%`,
      variant: rework.reworkPct < 5 ? "success" : rework.reworkPct < 15 ? "warning" : "danger",
    },
  ];

  return (
    <Document title={`${dashboardName} - ${lineName}`}>
      <Page size="A4" style={styles.coverPage}>
        {logo && (
          <Image
            src={logo.dataUrl}
            style={[styles.coverLogo, { width: logo.widthPt, height: logo.heightPt }]}
          />
        )}
        <Text style={styles.coverCompany}>{COMPANY_NAME}</Text>
        <Text style={styles.coverTitle}>{dashboardName}</Text>
        <Text style={styles.coverMeta}>Production Line: {lineName}</Text>
        <Text style={styles.coverMeta}>
          Reporting Period: {from} → {to}
        </Text>
        <Text style={styles.coverMeta}>Generated By: Production Scorecard System</Text>
        <Text style={styles.coverMeta}>Generated: {generatedAt.toLocaleString()}</Text>
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {logo && (
              <Image
                src={logo.dataUrl}
                style={[
                  styles.headerLogo,
                  { width: Math.min(logo.widthPt, 28), height: Math.min(logo.heightPt, 28) },
                ]}
              />
            )}
            <View>
              <Text style={styles.headerCompany}>{COMPANY_NAME}</Text>
              <Text style={styles.headerDashboard}>{dashboardName}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerMeta}>
              Line: {lineName} | Period: {from} → {to}
            </Text>
            <Text style={styles.headerMeta}>Generated By: Production Scorecard System</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>Generated {generatedAt.toLocaleString()}</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber - 1} of ${totalPages - 1}`}
          />
        </View>

        <SectionHeading
          title="1. Making / Depositing Performance"
          subtitle="Plan vs Actual — Weight (kg), Month to Date"
        />
        <KpiRow items={performanceKpis("Making", making)} />

        <SectionHeading
          title="2. Packing Performance"
          subtitle="Plan vs Actual — Packed Quantity (kg), Month to Date"
        />
        <KpiRow items={performanceKpis("Packing", packing)} />

        <SectionHeading
          title="3. Downtime, Stoppages & Loss %"
          subtitle="Pareto breakdown by cause and area, Month to Date"
        />
        <KpiRow items={downtimeKpis} />
        <ParetoTable rows={downtimeTotals.rows} />

        <SectionHeading
          title="4. Rework Quantities by Area"
          subtitle="Material returned to process for reprocessing, Month to Date"
        />
        <KpiRow items={reworkKpis} />

        <SectionHeading
          title="5. Daily Entries"
          subtitle={`${entries.length} entr${entries.length === 1 ? "y" : "ies"} in reporting period`}
        />
        <EntriesTable entries={entries} />
      </Page>
    </Document>
  );
}
