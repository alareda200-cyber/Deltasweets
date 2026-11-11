// What the Plant floor's line room loads for one line and period: the same
// queries as the Dashboard (same keys, so the cache is shared) and the same
// maths (periodNumbers, kpiTiles, lineOee), so every figure matches it.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { lineCapacitiesQuery } from "@/lib/capacity";
import { downtimeKindResolver, elapsedRange } from "@/lib/dashboard-metrics";
import { lineOee, type LineOeeResult, type OeeBasis } from "@/lib/line-oee";
import { periodNumbers, type PeriodNumbers } from "@/lib/line-period";
import { machineStops, type MachineStop } from "@/lib/machine-downtime";
import { nonProductionDayLookup } from "@/lib/maintenance-format";
import { withPackedActual } from "@/lib/packed-actual";
import { packedSkusQuery, packingMachinesQuery, machinesForLine } from "@/lib/packing";
import { withPackingOnlyDays } from "@/lib/packing-only-day";
import {
  DEFAULT_TARGETS,
  downtimeTypesQuery,
  entriesQuery,
  entryDowntimesForEntriesQuery,
  maintenanceEventsQuery,
  maintenanceStoppagesQuery,
  nonProductionDaysQuery,
  productionAreasQuery,
  productionTargetsQuery,
  severityLevelsQuery,
  type DailyEntry,
  type MaintenanceStoppage,
  type ProductionLine,
  type ProductionTargets,
} from "@/lib/queries";
import type { PackingMachine } from "@/lib/packing";

export interface LinePeriod {
  loading: boolean;
  failed: boolean;
  /** Maintenance couldn't be read: its minutes are missing, not zero. */
  machineError: boolean;
  list: DailyEntry[];
  /** The period as far as it has happened (stretched to a later entry). */
  shownTo: string;
  n: PeriodNumbers | null;
  stops: MachineStop[];
  stoppages: MaintenanceStoppage[];
  targets: ProductionTargets;
  oee: LineOeeResult | null;
  /** Whether the line has a making capacity at all (no capacity = no line OEE). */
  hasCapacity: boolean;
  machines: PackingMachine[];
}

export function useLinePeriod(line: ProductionLine | null, from: string, to: string): LinePeriod {
  const id = line?.id ?? null;
  const on = !!id;
  const entriesQ = useQuery({ ...entriesQuery(id, from, to), enabled: on });
  const packedQ = useQuery(packedSkusQuery(from, to));
  const entries = useMemo(
    () => withPackingOnlyDays(withPackedActual(entriesQ.data, packedQ.data)),
    [entriesQ.data, packedQ.data],
  );
  const entryIds = useMemo(() => (entries ?? []).map((e) => e.id), [entries]);
  const downtimesQ = useQuery(entryDowntimesForEntriesQuery(entryIds));
  const mEventsQ = useQuery({
    ...maintenanceEventsQuery(id, null, null, from, to),
    enabled: on,
  });
  const stoppagesQ = useQuery({ ...maintenanceStoppagesQuery(id), enabled: on });
  const closedQ = useQuery(nonProductionDaysQuery());
  const targetsQ = useQuery(productionTargetsQuery());
  const typesQ = useQuery(downtimeTypesQuery);
  const severityQ = useQuery(severityLevelsQuery);
  const areasQ = useQuery(productionAreasQuery);
  const capsQ = useQuery(lineCapacitiesQuery);
  const machinesQ = useQuery(packingMachinesQuery);

  const hasIds = entryIds.length > 0;
  const loading =
    !on ||
    entriesQ.isPending ||
    (hasIds && downtimesQ.isPending) ||
    mEventsQ.isPending ||
    stoppagesQ.isPending ||
    typesQ.isPending ||
    severityQ.isPending ||
    areasQ.isPending ||
    capsQ.isPending;
  const failed = entriesQ.isError || (hasIds && downtimesQ.isError);
  const machineError = mEventsQ.isError || stoppagesQ.isError;
  const targets = targetsQ.data ?? DEFAULT_TARGETS;

  return useMemo((): LinePeriod => {
    const list = entries ?? [];
    const elapsed = elapsedRange(from, to);
    const lastDate = list.length > 0 ? list[list.length - 1].entry_date : null;
    const shownTo = lastDate && lastDate > elapsed.to ? lastDate : elapsed.to;
    const machines = line ? machinesForLine(machinesQ.data ?? [], line.id) : [];
    const capacities = capsQ.data ?? [];
    const hasCapacity = !!line && capacities.some((c) => c.line_id === line.id);
    const base = {
      loading,
      failed,
      machineError,
      list,
      shownTo,
      stoppages: stoppagesQ.data ?? [],
      targets,
      hasCapacity,
      machines,
    };
    if (loading || failed || !line) return { ...base, n: null, stops: [], oee: null };
    // Same rules as the Dashboard (src/routes/index.tsx › PeriodBody).
    const downtimes = (downtimesQ.data ?? []).filter((d) => d.is_active !== false);
    const kindOf = downtimeKindResolver(typesQ.data ?? []);
    const stops = machineError
      ? []
      : machineStops(
          mEventsQ.data ?? [],
          stoppagesQ.data ?? [],
          nonProductionDayLookup(closedQ.data ?? []),
        );
    const n = periodNumbers({
      list,
      downtimes,
      kindOf,
      stops,
      severityLevels: severityQ.data ?? [],
      productionAreas: areasQ.data ?? [],
    });
    const unit = line.making_count_unit?.trim() || null;
    const basis: OeeBasis = line.oee_basis === "count" && unit ? "count" : "kg";
    const oee = hasCapacity
      ? lineOee({ entries: list, capacities, lineId: line.id, basis, lostByDay: n.lostByDay })
      : null;
    return { ...base, n, stops, oee };
  }, [
    entries,
    from,
    to,
    line,
    machinesQ.data,
    capsQ.data,
    loading,
    failed,
    machineError,
    stoppagesQ.data,
    targets,
    downtimesQ.data,
    typesQ.data,
    mEventsQ.data,
    closedQ.data,
    severityQ.data,
    areasQ.data,
  ]);
}
