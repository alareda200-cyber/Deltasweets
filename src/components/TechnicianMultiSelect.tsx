import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Technician } from "@/lib/queries";

// Shared between CreateEventDialog and EventDetailDialog in
// src/routes/maintenance.tsx — one place to fix bugs in how technicians are
// assigned to an event. `technicians` is expected to already be filtered to
// is_active by the caller (see techniciansQuery's own comment on why that
// filtering isn't baked into the query itself): an event already assigned
// to someone who's since gone inactive keeps its assignment (technician_ids
// isn't touched just because the roster changed), it just can't be
// re-selected for a *new* assignment here.
export function TechnicianMultiSelect({
  technicians,
  selectedIds,
  onChange,
}: {
  technicians: Technician[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  const selectedNames = technicians.filter((t) => selectedIds.includes(t.id)).map((t) => t.name);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-auto min-h-9 w-full justify-between font-normal"
        >
          <span className="truncate text-left">
            {selectedNames.length > 0 ? selectedNames.join(", ") : "Select technicians…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-2" align="start">
        {technicians.length === 0 ? (
          <p className="p-2 text-center text-xs text-muted-foreground">
            No active technicians — add some in Settings.
          </p>
        ) : (
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {technicians.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox checked={selectedIds.includes(t.id)} onCheckedChange={() => toggle(t.id)} />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {(t.role || t.department) && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {[t.role, t.department].filter(Boolean).join(" · ")}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
