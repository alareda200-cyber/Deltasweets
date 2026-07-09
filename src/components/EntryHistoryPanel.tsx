import { useMemo, useState } from "react";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Pencil, Trash2, Copy, ArrowUpDown } from "lucide-react";
import { allEntriesQuery, entryAreaOwnersForEntriesQuery, linesQuery, type EntryHistoryRow } from "@/lib/queries";
import { monthRange } from "@/lib/date-utils";

const PAGE_SIZE = 15;

interface Props {
  lines: { id: string; name: string }[];
  onView: (row: EntryHistoryRow) => void;
  onEdit?: (row: EntryHistoryRow) => void;
  onDuplicate?: (row: EntryHistoryRow) => void;
  onDelete?: (row: EntryHistoryRow) => void;
}

type SortKey = "entry_date" | "shift" | "line" | "making_actual" | "downtime_min" | "avg_score" | "created_at" | "updated_at";

export function EntryHistoryPanel({ lines, onView, onEdit, onDuplicate, onDelete }: Props) {
  const initial = monthRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [lineFilter, setLineFilter] = useState<string>("all");
  const [shiftFilter, setShiftFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("entry_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const { data: allEntries = [] } = useQuery(allEntriesQuery(from, to));
  const entryIds = useMemo(() => allEntries.map((e) => e.id), [allEntries]);
  const { data: areaOwnerRows = [] } = useQuery(entryAreaOwnersForEntriesQuery(entryIds));

  const avgScoreByEntry = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const row of areaOwnerRows) {
      if (row.performance_score == null) continue;
      const cur = map.get(row.entry_id) ?? { total: 0, count: 0 };
      cur.total += Number(row.performance_score);
      cur.count += 1;
      map.set(row.entry_id, cur);
    }
    const result = new Map<string, number>();
    map.forEach((v, k) => result.set(k, v.total / v.count));
    return result;
  }, [areaOwnerRows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allEntries.filter((e) => {
      if (lineFilter !== "all" && e.line_id !== lineFilter) return false;
      if (shiftFilter !== "all" && e.shift !== shiftFilter) return false;
      if (!term) return true;
      const haystack = `${e.entry_date} ${e.shift} ${e.production_lines?.name ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [allEntries, lineFilter, shiftFilter, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortKey) {
        case "line": av = a.production_lines?.name ?? ""; bv = b.production_lines?.name ?? ""; break;
        case "avg_score": av = avgScoreByEntry.get(a.id) ?? -1; bv = avgScoreByEntry.get(b.id) ?? -1; break;
        default: av = a[sortKey] as string | number; bv = b[sortKey] as string | number;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [filtered, sortKey, sortDir, avgScoreByEntry]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
    setPage(1);
  }

  function SortHeader({ label, sortField }: { label: string; sortField: SortKey }) {
    return (
      <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort(sortField)}>
        <span className="flex items-center gap-1">{label} <ArrowUpDown className="h-3 w-3 opacity-50" /></span>
      </TableHead>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entry History</CardTitle>
        <CardDescription>Search, filter, and manage every recorded entry without leaving this page.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-[150px]" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-[150px]" />
          </div>
          <Select value={lineFilter} onValueChange={(v) => { setLineFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Line" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Lines</SelectItem>
              {lines.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={shiftFilter} onValueChange={(v) => { setShiftFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[130px]"><SelectValue placeholder="Shift" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Shifts</SelectItem>
              <SelectItem value="A">Shift A</SelectItem>
              <SelectItem value="B">Shift B</SelectItem>
              <SelectItem value="C">Shift C</SelectItem>
              <SelectItem value="DAY">Full Day</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Search date, line, shift…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-[220px]" />
        </div>

        <div className="max-h-[420px] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <SortHeader label="Date" sortField="entry_date" />
                <SortHeader label="Shift" sortField="shift" />
                <SortHeader label="Line" sortField="line" />
                <SortHeader label="Production Qty" sortField="making_actual" />
                <SortHeader label="Downtime (min)" sortField="downtime_min" />
                <SortHeader label="Avg Score" sortField="avg_score" />
                <SortHeader label="Created At" sortField="created_at" />
                <SortHeader label="Last Updated" sortField="updated_at" />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No entries match the current filters.</TableCell></TableRow>
              )}
              {pageRows.map((row) => {
                const avg = avgScoreByEntry.get(row.id);
                return (
                  <TableRow key={row.id} className="hover:bg-muted/50">
                    <TableCell className="whitespace-nowrap">{row.entry_date}</TableCell>
                    <TableCell>{row.shift}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.production_lines?.name ?? "—"}</TableCell>
                    <TableCell>{row.making_actual}</TableCell>
                    <TableCell>{row.downtime_min}</TableCell>
                    <TableCell>{avg != null ? `${avg.toFixed(1)}%` : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(row.updated_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" title="View" onClick={() => onView(row)}><Eye className="h-4 w-4" /></Button>
                        {onEdit && <Button size="icon" variant="ghost" title="Edit" onClick={() => onEdit(row)}><Pencil className="h-4 w-4" /></Button>}
                        {onDuplicate && <Button size="icon" variant="ghost" title="Duplicate" onClick={() => onDuplicate(row)}><Copy className="h-4 w-4" /></Button>}
                        {onDelete && <Button size="icon" variant="ghost" title="Delete" onClick={() => onDelete(row)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{sorted.length} entr{sorted.length === 1 ? "y" : "ies"} · Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
