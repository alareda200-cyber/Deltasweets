import { useEffect, useId, useMemo, useState } from "react";
import { Merge, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ConfirmDialog,
  IconButton,
  ListRow,
  SectionHeader,
  WarningNote,
  plural,
  type QC,
} from "./shared";

export interface FaultTitleStat {
  title: string;
  count: number;
}

// Two titles are "the same fault, typed differently" if they're identical
// once case and incidental whitespace are ignored.
function normalizeTitleKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Every query that reflects a maintenance_events.title value — invalidated
// together after every rename/merge. maintenance-metrics isn't included: it
// aggregates by line/date, not by title.
function invalidateFaultTitleQueries(qc: QC) {
  qc.invalidateQueries({ queryKey: ["fault-title-stats"] });
  qc.invalidateQueries({ queryKey: ["maintenance-events"] });
  qc.invalidateQueries({ queryKey: ["maintenance-stoppage-events"] });
}

// A pending bulk rewrite, waiting on the confirm dialog: every event titled
// one of `from` gets `to`.
interface PendingRewrite {
  kind: "rename" | "merge";
  from: FaultTitleStat[];
  to: string;
}

export function FaultTitlesSection({ stats, qc }: { stats: FaultTitleStat[]; qc: QC }) {
  const [renaming, setRenaming] = useState<FaultTitleStat | null>(null);
  const [merging, setMerging] = useState<FaultTitleStat | null>(null);
  const [pending, setPending] = useState<PendingRewrite | null>(null);
  const totalEvents = stats.reduce((s, x) => s + x.count, 0);

  // Titles that normalize identically but aren't literally the same string —
  // most-used spelling first, as the natural merge target.
  const duplicateGroups = useMemo(() => {
    const byKey = new Map<string, FaultTitleStat[]>();
    for (const s of stats) {
      const key = normalizeTitleKey(s.title);
      const group = byKey.get(key);
      if (group) group.push(s);
      else byKey.set(key, [s]);
    }
    return Array.from(byKey.values())
      .filter((group) => group.length > 1)
      .map((group) => [...group].sort((a, b) => b.count - a.count));
  }, [stats]);

  // Relabelling a title is always the same UPDATE, whichever UI triggered it.
  async function renameTitle(oldTitle: string, newTitle: string) {
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === oldTitle) return false;
    const { error } = await supabase
      .from("maintenance_events")
      .update({ title: trimmed })
      .eq("title", oldTitle);
    if (error) {
      toast.error(error.message);
      return false;
    }
    void logAudit("settings.update", "maintenance_event_title", undefined, {
      from: oldTitle,
      to: trimmed,
    });
    return true;
  }

  async function runPending(): Promise<boolean> {
    const p = pending;
    if (!p) return true;
    const changed = p.from.reduce((s, x) => s + x.count, 0);
    try {
      for (const f of p.from) {
        const ok = await renameTitle(f.title, p.to);
        if (!ok) return false;
      }
    } finally {
      invalidateFaultTitleQueries(qc);
    }
    toast.success(
      p.kind === "rename"
        ? `Renamed to “${p.to.trim()}” — ${plural(changed, "event")} updated`
        : `Merged into “${p.to}” — ${plural(changed, "event")} updated`,
    );
    setRenaming(null);
    setMerging(null);
    return true;
  }

  const pendingCount = pending?.from.reduce((s, x) => s + x.count, 0) ?? 0;

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader
        id="faultTitles"
        count={stats.length}
        description={`Every title used on a maintenance event, plant-wide — ${plural(stats.length, "title")} across ${plural(totalEvents, "event")}. Rename or merge to keep repeat-fault reporting clean.`}
      />
      <WarningNote>
        Renaming or merging rewrites the title on every past maintenance event that carries it.
        There is no undo.
      </WarningNote>
      <Card>
        <CardContent className="space-y-4 p-4 md:p-6">
          {duplicateGroups.length > 0 && (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="text-sm font-semibold text-warning-strong">
                Similar titles found — likely the same fault typed differently
              </p>
              {duplicateGroups.map((group) => (
                <div
                  key={group.map((g) => g.title).join("|")}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/60 p-2 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    {group.map((g, i) => (
                      <span key={g.title}>
                        {i > 0 && <span className="text-muted-foreground"> · </span>}
                        <span className={i === 0 ? "font-medium" : "text-muted-foreground"}>
                          {g.title}
                        </span>{" "}
                        <span className="text-xs tabular-nums text-muted-foreground">
                          ({g.count})
                        </span>
                      </span>
                    ))}
                  </span>
                  <Button
                    variant="outline"
                    className="h-11 md:h-9"
                    onClick={() =>
                      setPending({ kind: "merge", from: group.slice(1), to: group[0].title })
                    }
                  >
                    <Merge className="h-4 w-4" aria-hidden="true" />
                    Merge into “{group[0].title}”
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="max-h-[32rem] space-y-1.5 overflow-auto">
            {stats.map((s) => (
              <ListRow key={s.title}>
                <p className="min-w-0 flex-1 truncate font-medium">{s.title}</p>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {plural(s.count, "event")}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    icon={Pencil}
                    label={`Rename ${s.title}`}
                    onClick={() => setRenaming(s)}
                  />
                  <IconButton
                    icon={Merge}
                    label={`Merge ${s.title} into another title`}
                    disabled={stats.length < 2}
                    onClick={() => setMerging(s)}
                  />
                </div>
              </ListRow>
            ))}
            {stats.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">
                No maintenance events logged yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <RenameFaultTitleDialog
        stat={renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        onSubmit={(to) => renaming && setPending({ kind: "rename", from: [renaming], to })}
      />
      <MergeFaultTitleDialog
        stat={merging}
        others={stats.filter((s) => s.title !== merging?.title)}
        onOpenChange={(o) => !o && setMerging(null)}
        onSubmit={(to) => merging && setPending({ kind: "merge", from: [merging], to })}
      />
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={
          pending?.kind === "rename"
            ? `Rename “${pending.from[0]?.title}” to “${pending.to.trim()}”?`
            : `Merge into “${pending?.to ?? ""}”?`
        }
        description={
          <>
            <p>
              This rewrites the title on{" "}
              <strong className="text-foreground">
                {plural(pendingCount, "maintenance event")}
              </strong>
              {pending?.kind === "merge" && (
                <> currently titled {pending.from.map((f) => `“${f.title}”`).join(", ")}</>
              )}
              .
            </p>
            <p>Past reports will show the new title. This cannot be undone.</p>
          </>
        }
        confirmLabel={
          pending?.kind === "rename"
            ? `Rename ${plural(pendingCount, "event")}`
            : `Merge ${plural(pendingCount, "event")}`
        }
        onConfirm={runPending}
      />
    </div>
  );
}

function RenameFaultTitleDialog({
  stat,
  onOpenChange,
  onSubmit,
}: {
  stat: FaultTitleStat | null;
  onOpenChange: (o: boolean) => void;
  onSubmit: (newTitle: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputId = useId();

  useEffect(() => {
    setValue(stat?.title ?? "");
  }, [stat?.title]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stat || !value.trim() || value.trim() === stat.title) return;
    onSubmit(value.trim());
  }

  return (
    <Dialog open={!!stat} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left">Rename fault title</DialogTitle>
          <DialogDescription className="text-left">
            Applies to every maintenance event currently titled “{stat?.title}” (
            {plural(stat?.count ?? 0, "event")}).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>New title</Label>
            <Input
              id={inputId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              autoFocus
              className="h-11 md:h-9"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-11 md:h-9"
              disabled={!value.trim() || value.trim() === stat?.title}
            >
              Rename…
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MergeFaultTitleDialog({
  stat,
  others,
  onOpenChange,
  onSubmit,
}: {
  stat: FaultTitleStat | null;
  others: FaultTitleStat[];
  onOpenChange: (o: boolean) => void;
  onSubmit: (target: string) => void;
}) {
  const [target, setTarget] = useState("");
  const selectId = useId();

  useEffect(() => {
    setTarget("");
  }, [stat?.title]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stat || !target) return;
    onSubmit(target);
  }

  return (
    <Dialog open={!!stat} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left">Merge fault title</DialogTitle>
          <DialogDescription className="text-left">
            Relabels every event currently titled “{stat?.title}” (
            {plural(stat?.count ?? 0, "event")}) to the title picked below — “{stat?.title}” then
            disappears from this list.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={selectId}>Merge into</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id={selectId} className="h-11 md:h-9">
                <SelectValue placeholder="Select target title" />
              </SelectTrigger>
              <SelectContent>
                {others.map((o) => (
                  <SelectItem key={o.title} value={o.title}>
                    {o.title} ({o.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 md:h-9" disabled={!target}>
              Merge…
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
