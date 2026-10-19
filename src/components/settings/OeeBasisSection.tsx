// Settings › Production lines › Line OEE: whether a line's making OEE is
// counted in kg or in the unit the line also counts making in (pallets…).
// The ideal speed is the line's making capacity in that unit.
import { useQueryClient } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import type { ProductionLine } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";

export function OeeBasisSection({ lines }: { lines: ProductionLine[] }) {
  const qc = useQueryClient();
  async function setBasis(l: ProductionLine, basis: "kg" | "count") {
    if ((l.oee_basis ?? "kg") === basis) return;
    const { error } = await supabase
      .from("production_lines")
      .update({ oee_basis: basis })
      .eq("id", l.id);
    if (error) return toast.error(error.message);
    void logAudit("line.oee_basis", "production_line", l.id, { basis });
    toast.success(`${l.name}: OEE by ${basis === "kg" ? "kg" : l.making_count_unit}`);
    qc.invalidateQueries({ queryKey: ["lines"] });
  }
  return (
    <Card data-testid="oee-basis-section">
      <CardContent className="space-y-3 p-4 md:p-6">
        <div className="flex items-start gap-3">
          <Activity className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Line OEE</h3>
            <p className="text-sm text-muted-foreground">
              Each line&rsquo;s OEE on the Dashboard comes from its making: in kg, or in the unit it
              also counts (pallets…). The ideal speed is the making capacity above, in the same
              unit. A line without a capacity has no OEE.
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          {lines.map((l) => {
            const unit = l.making_count_unit?.trim() || null;
            const basis = l.oee_basis === "count" && unit ? "count" : "kg";
            return (
              <div
                key={l.id}
                className="flex min-h-12 items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded" style={{ background: l.color }} />
                  <span className="truncate text-sm font-medium">{l.name}</span>
                </span>
                <div className="flex shrink-0 gap-1" role="group" aria-label={`${l.name} OEE by`}>
                  {(unit ? (["kg", "count"] as const) : (["kg"] as const)).map((b) => (
                    <button
                      key={b}
                      type="button"
                      aria-pressed={basis === b}
                      onClick={() => setBasis(l, b)}
                      className={cn(
                        "h-11 min-w-14 rounded-full border px-3 text-sm font-semibold md:h-9",
                        basis === b
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-card hover:bg-muted",
                      )}
                    >
                      {b === "kg" ? "kg" : unit}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
