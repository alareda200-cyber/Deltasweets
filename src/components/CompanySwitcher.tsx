// The company in view, in the header (approved mockup, 12 Oct 2026).
//
// A small pill under "Delta Sweets", where "Production scorecard" was. Phone:
// tapping it opens a bottom sheet with the companies; desktop: a menu.
// Someone tied to one company gets the same pill with a lock and no choice.
import type React from "react";
import { useState } from "react";
import { Check, ChevronDown, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompany, type Company } from "@/lib/companies";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const tint = (c: Company) => ({
  color: c.color,
  backgroundColor: `color-mix(in oklab, ${c.color} 14%, transparent)`,
});

/** Phone (below md): pill + bottom sheet. `fallback` shows until the companies load. */
export function CompanyPill({ fallback = null }: { fallback?: React.ReactNode }) {
  const { companies, current, canSwitch, switching, switchTo } = useCompany();
  const [open, setOpen] = useState(false);
  if (!current) return <>{fallback}</>;

  const inner = (
    <>
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-current" />
      <span className="truncate">{current.name}</span>
      {switching ? (
        <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
      ) : canSwitch ? (
        <ChevronDown aria-hidden="true" className="h-3 w-3 opacity-70" />
      ) : (
        <Lock aria-hidden="true" className="h-3 w-3 opacity-70" />
      )}
    </>
  );

  if (!canSwitch) {
    return (
      <span
        data-testid="company-pill"
        data-company={current.name}
        className="mt-0.5 inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2 text-xs font-semibold md:hidden"
        style={tint(current)}
        title={`You see ${current.name} only`}
      >
        {inner}
      </span>
    );
  }

  return (
    <>
      {/* The visible pill is 24px tall; the button's hit area is 44px. */}
      <button
        type="button"
        data-testid="company-pill"
        data-company={current.name}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Company: ${current.name}. Change company`}
        className="relative -my-2.5 inline-flex min-h-11 max-w-full items-center py-2.5 md:hidden"
      >
        <span
          className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2 text-xs font-semibold transition-colors duration-300"
          style={tint(current)}
        >
          {inner}
        </span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-[20px] px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-3 md:hidden"
        >
          <div aria-hidden="true" className="mx-auto mb-1 h-1 w-10 rounded-full bg-border" />
          <SheetHeader className="text-left">
            <SheetTitle className="text-base">Company</SheetTitle>
            <SheetDescription className="text-xs">
              Every page shows the company you pick here.
            </SheetDescription>
          </SheetHeader>
          <div role="radiogroup" aria-label="Company" className="mt-3 flex flex-col gap-2">
            {companies.map((c) => {
              const on = c.id === current.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-company-option={c.name}
                  disabled={!!switching}
                  onClick={async () => {
                    setOpen(false);
                    await switchTo(c.id);
                  }}
                  className={cn(
                    "flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-card px-3 text-left transition-colors",
                    on ? "border-foreground" : "border-border hover:bg-muted",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base font-bold"
                    style={tint(c)}
                  >
                    {c.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                    {c.name}
                  </span>
                  {on && <Check aria-hidden="true" className="h-5 w-5 text-primary" />}
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * Desktop (md and up): the same pill under "Delta Sweets", opening a menu.
 * (The mockup's segmented control next to the logo pushed Audit log and
 * Settings out of the 1280px header, so the company sits where the subtitle
 * was, as on the phone.)
 */
export function CompanyMenu({ fallback = null }: { fallback?: React.ReactNode }) {
  const { companies, current, canSwitch, switching, switchTo } = useCompany();
  if (!current) return <>{fallback}</>;

  if (!canSwitch) {
    return (
      <span
        data-testid="company-badge"
        data-company={current.name}
        className="mt-0.5 hidden h-[22px] items-center gap-1.5 rounded-full px-2 text-xs font-semibold md:inline-flex"
        style={tint(current)}
        title={`You see ${current.name} only`}
      >
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />
        {current.name}
        <Lock aria-hidden="true" className="h-3 w-3 opacity-70" />
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="company-menu"
          data-company={current.name}
          aria-label={`Company: ${current.name}. Change company`}
          className="mt-0.5 hidden h-[22px] items-center gap-1.5 rounded-full px-2 text-xs font-semibold transition-colors duration-300 hover:brightness-95 md:inline-flex"
          style={tint(current)}
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />
          {current.name}
          {switching ? (
            <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-3 w-3 opacity-70" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Every page shows this company
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.id} onValueChange={(id) => void switchTo(id)}>
          {companies.map((c) => (
            <DropdownMenuRadioItem
              key={c.id}
              value={c.id}
              data-company-option={c.name}
              disabled={!!switching}
              className="h-10 gap-2"
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              {c.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
