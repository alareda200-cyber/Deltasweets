import { useId, useState } from "react";
import { CalendarRange, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { shortRange, type AuditFilters as Filters, type AuditTab } from "@/lib/audit-format";

export interface Option {
  value: string;
  label: string;
}

const ALL = "__all__";

function rangeLabel(from: string, to: string) {
  if (from && to) return from <= to ? shortRange(from, to) : shortRange(to, from);
  if (from) return `From ${shortRange(from, from)}`;
  if (to) return `Up to ${shortRange(to, to)}`;
  return "All dates";
}

function PersonSelect({
  id,
  value,
  persons,
  onChange,
  className,
}: {
  id: string;
  value: string;
  persons: Option[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger id={id} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Everyone</SelectItem>
        {persons.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ActionSelect({
  id,
  value,
  actions,
  tab,
  onChange,
  className,
}: {
  id: string;
  value: string;
  actions: Option[];
  tab: AuditTab;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger id={id} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>
          {tab === "changes" ? "All changes" : "Sign-ins and sign-outs"}
        </SelectItem>
        {actions.map((a) => (
          <SelectItem key={a.value} value={a.value}>
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DateFields({
  idBase,
  from,
  to,
  onChange,
  inputClass,
}: {
  idBase: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  inputClass?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${idBase}-from`}>From</Label>
        <Input
          id={`${idBase}-from`}
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => onChange(e.target.value, to)}
          className={inputClass}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idBase}-to`}>To</Label>
        <Input
          id={`${idBase}-to`}
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => onChange(from, e.target.value)}
          className={inputClass}
        />
      </div>
    </div>
  );
}

/**
 * Search, person, action and a date range. Desktop shows them inline (the
 * range in a popover); mobile keeps the search and moves the rest behind a
 * "Filters" button that says how many are set. Dates are local calendar days.
 */
export function AuditFilters({
  filters,
  onChange,
  persons,
  actions,
  tab,
  matchCount,
}: {
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
  persons: Option[];
  actions: Option[];
  tab: AuditTab;
  matchCount: number;
}) {
  const uid = useId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const hidden = [filters.person, filters.action, filters.from || filters.to].filter(
    Boolean,
  ).length;
  const range = rangeLabel(filters.from, filters.to);
  const clear = () => onChange({ person: "", action: "", from: "", to: "" });

  return (
    <>
      {/* Mobile */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:hidden">
        <div className="min-w-0">
          <Label htmlFor={`${uid}-m-search`} className="sr-only">
            Search
          </Label>
          <Input
            id={`${uid}-m-search`}
            type="search"
            placeholder="Search person or event"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            className="h-12 text-base"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-12 px-3.5 text-[15px]"
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontal aria-hidden="true" />
          Filters{hidden > 0 ? ` · ${hidden}` : ""}
        </Button>
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl md:hidden"
        >
          <SheetHeader className="text-left">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Dates are your local calendar days.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-m-person`}>Person</Label>
              <PersonSelect
                id={`${uid}-m-person`}
                value={filters.person}
                persons={persons}
                onChange={(person) => onChange({ person })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-m-action`}>What</Label>
              <ActionSelect
                id={`${uid}-m-action`}
                value={filters.action}
                actions={actions}
                tab={tab}
                onChange={(action) => onChange({ action })}
                className="h-11"
              />
            </div>
            <DateFields
              idBase={`${uid}-m`}
              from={filters.from}
              to={filters.to}
              onChange={(from, to) => onChange({ from, to })}
              inputClass="h-11 text-base"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={clear}
                disabled={hidden === 0}
              >
                Clear filters
              </Button>
              <Button type="button" className="h-11" onClick={() => setSheetOpen(false)}>
                Show {matchCount} {matchCount === 1 ? "event" : "events"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <div>
          <Label htmlFor={`${uid}-search`} className="sr-only">
            Search
          </Label>
          <Input
            id={`${uid}-search`}
            type="search"
            placeholder="Search person, event, line"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            className="h-11 w-[260px]"
          />
        </div>
        <Label htmlFor={`${uid}-person`} className="sr-only">
          Person
        </Label>
        <PersonSelect
          id={`${uid}-person`}
          value={filters.person}
          persons={persons}
          onChange={(person) => onChange({ person })}
          className="h-11 w-auto min-w-[150px] max-w-[220px]"
        />
        <Label htmlFor={`${uid}-action`} className="sr-only">
          What
        </Label>
        <ActionSelect
          id={`${uid}-action`}
          value={filters.action}
          actions={actions}
          tab={tab}
          onChange={(action) => onChange({ action })}
          className="h-11 w-auto min-w-[170px] max-w-[260px]"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              aria-label={`Date range: ${range}`}
            >
              <CalendarRange aria-hidden="true" />
              {range}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <p className="mb-3 text-sm font-semibold">Date range</p>
            <DateFields
              idBase={uid}
              from={filters.from}
              to={filters.to}
              onChange={(from, to) => onChange({ from, to })}
              inputClass="h-9"
            />
            <p className="mt-2 text-xs text-muted-foreground">Local calendar days, inclusive.</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              disabled={!filters.from && !filters.to}
              onClick={() => onChange({ from: "", to: "" })}
            >
              All dates
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
