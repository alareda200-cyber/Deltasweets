import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog, SectionHeader, WarningNote, type QC } from "./shared";

const BACKUP_TABLES = [
  "production_lines",
  "production_areas",
  "area_owners",
  "downtime_reasons",
  "departments",
  "department_categories",
  "downtime_types",
  "severity_levels",
  "line_field_definitions",
] as const;

export function BackupSection({ qc }: { qc: QC }) {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const payload: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        version: 1,
      };
      for (const table of BACKUP_TABLES) {
        const { data, error } = await supabase.from(table).select("*");
        if (error) throw error;
        payload[table] = data;
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `production-scorecard-settings-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Settings exported");
      void logAudit("settings.export", "backup");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setPendingFile(file);
  }

  async function runImport(): Promise<boolean> {
    const file = pendingFile;
    if (!file) return true;
    setImporting(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      let totalRows = 0;
      for (const table of BACKUP_TABLES) {
        const rows = payload[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
        if (error) throw error;
        totalRows += rows.length;
      }
      toast.success(`Settings imported (${totalRows} rows)`);
      void logAudit("settings.import", "backup", undefined, { totalRows });
      for (const key of [
        "lines",
        "reasons",
        "production-areas",
        "area-owners",
        "departments",
        "department-categories",
        "downtime-types",
        "severity-levels",
        "line-field-counts",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Import failed — check the file is a valid export from this app.",
      );
      return true;
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader id="backup" />
      <Card>
        <CardContent className="space-y-4 p-4 md:p-6">
          <p className="text-sm text-muted-foreground">
            Covers production lines, areas, area owners, downtime reasons, departments, department
            categories, downtime types, severity levels and line fields. Daily entries and
            maintenance events are not included.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="outline"
              className="h-11 md:h-9"
              onClick={handleExport}
              disabled={exporting}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {exporting ? "Exporting…" : "Export settings"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="sr-only"
              tabIndex={-1}
              aria-label="Backup file to restore"
              onChange={handlePick}
              disabled={importing}
            />
            <Button
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {importing ? "Restoring…" : "Restore from file…"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!pendingFile}
        onOpenChange={(o) => !o && setPendingFile(null)}
        title={`Restore settings from “${pendingFile?.name ?? ""}”?`}
        description={
          <>
            <p>
              Rows in the file that don’t exist yet are added. Rows with the same id are{" "}
              <strong className="text-foreground">overwritten</strong> — including names that past
              entries and reports read live.
            </p>
            <p>Export the current settings first if you might need them back.</p>
          </>
        }
        confirmLabel="Restore"
        onConfirm={runImport}
      />
    </div>
  );
}

// Single-row app_settings.reliability_start_date (see appSettingsQuery in
// src/lib/queries.ts). The whole route is admin-only ("settings.manage"), and
// the RLS "admin update app settings" policy is the real enforcement.
export function ReliabilitySection({
  reliabilityStartDate,
  rootCauseTrackingStartDate,
  qc,
}: {
  reliabilityStartDate: string | null;
  rootCauseTrackingStartDate: string | null;
  qc: QC;
}) {
  const { profile } = useAuth();
  const [value, setValue] = useState(reliabilityStartDate ?? "");
  const [saving, setSaving] = useState(false);
  const [rootCauseValue, setRootCauseValue] = useState(rootCauseTrackingStartDate ?? "");
  const [savingRootCause, setSavingRootCause] = useState(false);

  // Stay in sync if the row changes from outside (another admin, another tab).
  useEffect(() => {
    setValue(reliabilityStartDate ?? "");
  }, [reliabilityStartDate]);
  useEffect(() => {
    setRootCauseValue(rootCauseTrackingStartDate ?? "");
  }, [rootCauseTrackingStartDate]);

  const dirty = value !== (reliabilityStartDate ?? "");
  const rootCauseDirty = rootCauseValue !== (rootCauseTrackingStartDate ?? "");

  async function handleSave() {
    setSaving(true);
    try {
      const nextDate = value || null;
      const { error } = await supabase
        .from("app_settings")
        .update({
          reliability_start_date: nextDate,
          updated_by: profile?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
      toast.success("Reliability window saved");
      void logAudit("settings.update", "app_settings", "true", {
        reliability_start_date: nextDate,
      });
      // app-settings so every reader shows the saved value, maintenance-metrics
      // so every MTBF/MTTR card recomputes against the new window.
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      qc.invalidateQueries({ queryKey: ["maintenance-metrics"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRootCauseDate() {
    setSavingRootCause(true);
    try {
      const nextDate = rootCauseValue || null;
      const { error } = await supabase
        .from("app_settings")
        .update({
          root_cause_tracking_start_date: nextDate,
          updated_by: profile?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
      toast.success("Root cause tracking date saved");
      void logAudit("settings.update", "app_settings", "true", {
        root_cause_tracking_start_date: nextDate,
      });
      qc.invalidateQueries({ queryKey: ["app-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingRootCause(false);
    }
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader id="reliability" />
      <WarningNote>
        Moving this date changes every MTBF and MTTR figure in the app, for every past period. It
        never hides an event — it only decides which events the reliability math counts.
      </WarningNote>
      <Card>
        <CardContent className="space-y-4 p-4 md:p-6">
          <div>
            <h2 className="text-base font-semibold">Reliability start date</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              First date on which maintenance recording is complete. MTBF/MTTR ignore events before
              it. Empty means no window is declared, so everything counts.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reliability-start-date">Reliability start date</Label>
              <Input
                id="reliability-start-date"
                type="date"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-11 w-[180px] md:h-9"
              />
            </div>
            <Button onClick={handleSave} disabled={saving || !dirty} className="h-11 md:h-9">
              {saving ? "Saving…" : "Save"}
            </Button>
            {value !== "" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setValue("")}
                disabled={saving}
                className="h-11 md:h-9"
              >
                Clear (count everything)
              </Button>
            )}
          </div>
        </CardContent>
        <CardContent className="space-y-4 border-t border-border p-4 pt-4 md:p-6">
          <div>
            <h2 className="text-base font-semibold">Root cause tracking start date</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Root causes are recorded on the shift report from this date onward. Any percentage
              based on them covers this period only — events before it are unclassified because
              nobody was recording the cause yet, not because they had none.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="root-cause-tracking-start-date">Root cause tracking start date</Label>
              <Input
                id="root-cause-tracking-start-date"
                type="date"
                value={rootCauseValue}
                onChange={(e) => setRootCauseValue(e.target.value)}
                className="h-11 w-[180px] md:h-9"
              />
            </div>
            <Button
              onClick={handleSaveRootCauseDate}
              disabled={savingRootCause || !rootCauseDirty}
              className="h-11 md:h-9"
            >
              {savingRootCause ? "Saving…" : "Save"}
            </Button>
            {rootCauseValue !== "" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setRootCauseValue("")}
                disabled={savingRootCause}
                className="h-11 md:h-9"
              >
                Clear (not yet declared)
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
