import { TableRow, TableCell } from "@/components/ui/table";

// Rows of pulsing placeholder bars for a loading table body — shown instead
// of a single centered spinner so the table's own layout (header, column
// widths, row height) stays stable once real rows replace these instead of
// the whole table "jumping" into existence. Same idea as the Dashboard's
// ChartsSkeleton (src/routes/index.tsx), just shaped for <TableBody> rows
// instead of card sections. `columns` must match the real <TableHead> count
// so the skeleton's cells line up with the header exactly like real rows
// will. Bar widths vary per cell (deterministically, not randomly, so
// server/client render the same markup) purely for a more natural look.
export function TableSkeletonRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: columns }).map((_, j) => (
            <TableCell key={j}>
              <div
                className="h-4 animate-pulse rounded bg-muted"
                style={{ width: `${60 + ((i + j) % 4) * 10}%` }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
