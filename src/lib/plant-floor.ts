// Plant floor (route /plant): every line of the company on one screen, as it
// stands now, plus the production day so far (mockup "Jammy Control Room",
// approved 10 Nov 2026).
//
// What the system knows, and what it does not:
//
//   * A line's state comes from the maintenance log. A line shows Running until
//     a line-stopping event is logged for it. Preventive work is a planned
//     stop, not a fault, and is never counted as time lost. Overlapping
//     line-stopping events are ONE window, merged, never added up (the same
//     rule as Replay and the stoppage totals).
//   * Faults are usually logged the day after (the shift report is imported),
//     and entries are saved the next day. So the page opens on the latest day
//     that HAS a fault report, and "today" says plainly when nothing has been
//     logged for it yet (`reported`).
//   * Production is entered per day or per shift, never live. For a finished
//     day with an entry, the kg is the entry's making, spread over the minutes
//     the line ran (the same model as Replay). Without an entry, and always
//     for today, it is an estimate: the line's capacity per minute x the
//     minutes it was scheduled and not stopped. `kgKind` says which.
//   * Nothing records which hours a line is scheduled. They are read from the
//     line's entries: the day's own when it has them, else the last 7 days:
//     the shifts it enters (A 08-16, B 16-24, C 00-08), or, for a Full-day
//     line, its available minutes from 08:00. Recorded non-production days are
//     taken out. Friday is a day off (as in Plan adherence) unless the line
//     has an entry or an event that day.
//
// The production day runs 08:00 to 08:00, the three shifts of one entry date.
//
// Pure: no Supabase, no React, so it can be tested with plain node.

export const DAY_START_HOUR = 8;
export const DAY_MIN = 1440;
const MIN = 60_000;
/** A line with no entry in this many days is shown as not in use. */
export const RECENT_DAYS = 7;

export interface PlantEvent {
  id: string;
  line_id: string | null;
  type: string;
  title: string;
  status: string;
  started_at: string;
  resolved_at: string | null;
  stops_line: boolean;
  machine_id: string | null;
}

export interface PlantEntry {
  line_id: string;
  entry_date: string;
  shift: string;
  available_min: number;
  making_plan: number;
  making_actual: number;
  created_at?: string;
}

export interface PlantClosure {
  line_id: string | null;
  day: string;
  closed_from: string | null;
  closed_to: string | null;
}

export interface PlantLineInput {
  id: string;
  name: string;
  color: string;
}

export interface DayWindow {
  /** The entry date this production day belongs to, "YYYY-MM-DD". */
  day: string;
  startMs: number;
  endMs: number;
}

export type LineState = "running" | "stopped" | "preventive" | "off";

/** [s, e) in epoch ms. */
export interface Span {
  s: number;
  e: number;
}

export interface StopWindow extends Span {
  /** Only preventive work in this window: a planned stop, not a fault. */
  planned: boolean;
  titles: string[];
  /** Still open now. */
  open: boolean;
  /** Where it really started, when that is before this production day. */
  since: number;
  /** Where it really ended (now while open), when that is after this production day. */
  until: number;
}

export interface PlantLine {
  id: string;
  name: string;
  color: string;
  /** kg per minute at capacity; null = no capacity set. */
  ratePerMin: number | null;
  /** Scheduled spans inside the production day. */
  sched: Span[];
  /** Why there are no scheduled hours, or why some are missing. */
  offReason: string | null;
  /** The hours in words: "Shifts A, B", "Full day"… */
  hours: string;
  windows: StopWindow[];
  /** Faults that did not stop the line, and packing-machine faults. */
  minor: { s: number; e: number; title: string; machine: boolean; open: boolean }[];
  /** The last production day with entries before this one. */
  last: { day: string; made: number; plan: number } | null;
  /** Entered for this day (for today: so far). */
  entry: { made: number; plan: number; entries: number } | null;
  /** Fault stops that began in the day (windows, not member events). */
  stops: number;
}

export interface LineSnapshot {
  id: string;
  state: LineState;
  window: StopWindow | null;
  /** Why the line is off at this moment. */
  offReason: string | null;
  schedMin: number;
  /** Fault stops inside scheduled time, up to t. */
  lostMin: number;
  /** Preventive stops inside scheduled time, up to t. */
  plannedMin: number;
  runMin: number;
  /** kg up to t. null = no entry and no capacity. */
  kg: number | null;
  /** "made" = from the day's entry; "est" = capacity x running minutes. */
  kgKind: "made" | "est" | null;
  /** Open faults that are not stopping the line. */
  defects: number;
  machinesDown: number;
}

export interface PlantSnapshot {
  t: number;
  lines: LineSnapshot[];
  /** Lines scheduled at t. */
  scheduled: number;
  running: number;
  stopped: string[];
  preventive: string[];
  off: number;
  lostMin: number;
  plannedMin: number;
  schedMin: number;
  /** (scheduled - preventive - lost) / (scheduled - preventive); null = nothing scheduled yet. */
  availability: number | null;
  kg: number;
  /** Lines whose kg is the day's entry / an estimate / unknown (scheduled, no capacity). */
  madeLines: number;
  estLines: number;
  noRate: number;
}

export type FeedKind = "stop" | "resume" | "preventive" | "defect" | "machine" | "entry" | "shift";

export interface FeedItem {
  key: string;
  t: number;
  kind: FeedKind;
  lineId: string | null;
  title: string;
  /** Second line. `fault` is shown only to roles that may see fault names. */
  detail: string;
  fault: string | null;
}

export interface PlantModel {
  win: DayWindow;
  nowMs: number;
  /** The day is still running: `cap` is now. Otherwise `cap` is its end. */
  isToday: boolean;
  /** The last moment that can be looked at. */
  cap: number;
  /** At least one event began in this day: its fault report is in. */
  reported: boolean;
  lines: PlantLine[];
  /** Oldest first. */
  feed: FeedItem[];
  at(t: number): PlantSnapshot;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The production day that contains `nowMs`: before 08:00 it started yesterday. */
export function productionDay(nowMs: number): DayWindow {
  const n = new Date(nowMs);
  const start = new Date(n.getFullYear(), n.getMonth(), n.getDate(), DAY_START_HOUR);
  if (n.getHours() < DAY_START_HOUR) start.setDate(start.getDate() - 1);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, DAY_START_HOUR);
  return { day: isoDay(start), startMs: start.getTime(), endMs: end.getTime() };
}

/** The 08:00-to-08:00 window of an entry date. */
export function windowOf(day: string): DayWindow {
  const [y, m, d] = day.split("-").map(Number);
  return productionDay(new Date(y, m - 1, d, DAY_START_HOUR).getTime());
}

export function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return isoDay(new Date(y, m - 1, d + n));
}

/** "14:05" */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Sun 8 Nov" */
export const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** "48 min", "2 h 05 min" */
export function minutesText(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

const SHIFT_SPAN: Record<string, [number, number]> = {
  A: [0, 480],
  B: [480, 960],
  C: [960, 1440],
};

function overlap(a: Span, s: number, e: number): number {
  return Math.max(0, Math.min(a.e, e) - Math.max(a.s, s));
}

/** `spans` minus `cuts`; both lists may be unsorted. */
function subtract(spans: Span[], cuts: Span[]): Span[] {
  let out = spans;
  for (const c of cuts) {
    const next: Span[] = [];
    for (const s of out) {
      if (c.e <= s.s || c.s >= s.e) next.push(s);
      else {
        if (c.s > s.s) next.push({ s: s.s, e: c.s });
        if (c.e < s.e) next.push({ s: c.e, e: s.e });
      }
    }
    out = next;
  }
  return out;
}

function closureSpans(rows: PlantClosure[], lineId: string, win: DayWindow): Span[] {
  const out: Span[] = [];
  const days = [win.day, addDaysIso(win.day, 1)];
  for (const r of rows) {
    if (r.line_id !== null && r.line_id !== lineId) continue;
    if (!days.includes(r.day)) continue;
    const [y, m, d] = r.day.split("-").map(Number);
    // Minutes from local midnight; a missing time is the start or end of the day.
    const at = (t: string | null, fallback: number) => {
      const [h, mi] = t ? t.split(":").map(Number) : [0, fallback];
      return new Date(y, m - 1, d, 0, h * 60 + mi).getTime();
    };
    const s = Math.max(win.startMs, at(r.closed_from, 0));
    const e = Math.min(win.endMs, at(r.closed_to, DAY_MIN));
    if (e > s) out.push({ s, e });
  }
  return out;
}

/**
 * The hours a line is scheduled in this production day, read from its own
 * entries of the last RECENT_DAYS days (see the note at the top).
 */
function schedule(
  lineId: string,
  entries: PlantEntry[],
  closures: PlantClosure[],
  win: DayWindow,
  hasEventToday: boolean,
  finished: boolean,
): { sched: Span[]; offReason: string | null; hours: string } {
  const mine = entries.filter((e) => e.line_id === lineId);
  if (mine.length === 0) {
    return { sched: [], offReason: `No entries in ${RECENT_DAYS} days`, hours: "Not in use" };
  }
  // A finished day's own entries say how it ran. Today's are not all in yet
  // (shift C is entered tomorrow), so today goes by the recent days too.
  const own = finished ? mine.filter((e) => e.entry_date === win.day) : [];
  const shifts = new Set<string>();
  let dayAvail = 0;
  for (const e of own.length > 0 ? own : mine) {
    if (e.shift === "DAY") dayAvail = Math.max(dayAvail, e.available_min || 0);
    else if (SHIFT_SPAN[e.shift]) shifts.add(e.shift);
  }
  let spans: Span[];
  let hours: string;
  if (shifts.size > 0) {
    const list = ["A", "B", "C"].filter((s) => shifts.has(s));
    spans = list.map((s) => ({
      s: win.startMs + SHIFT_SPAN[s][0] * MIN,
      e: win.startMs + SHIFT_SPAN[s][1] * MIN,
    }));
    hours =
      list.length === 3
        ? "Shifts A, B, C"
        : `Shift${list.length > 1 ? "s" : ""} ${list.join(", ")}`;
  } else {
    const len = Math.min(DAY_MIN, dayAvail > 0 ? dayAvail : DAY_MIN);
    spans = [{ s: win.startMs, e: win.startMs + len * MIN }];
    hours = len >= DAY_MIN ? "Full day" : `${hhmm(win.startMs)}–${hhmm(win.startMs + len * MIN)}`;
  }
  const friday = new Date(win.startMs).getDay() === 5;
  if (friday && !hasEventToday && !mine.some((e) => e.entry_date === win.day)) {
    return { sched: [], offReason: "Friday, day off", hours };
  }
  const cuts = closureSpans(closures, lineId, win);
  const sched = subtract(spans, cuts).sort((a, b) => a.s - b.s);
  return {
    sched,
    offReason: sched.length === 0 ? "Non-production day" : null,
    hours,
  };
}

function stopWindows(events: PlantEvent[], win: DayWindow, nowMs: number): StopWindow[] {
  const raw = events
    .filter((e) => e.stops_line && !e.machine_id)
    .map((e) => {
      const start = new Date(e.started_at).getTime();
      const open = !e.resolved_at;
      const end = open ? nowMs : new Date(e.resolved_at as string).getTime();
      return {
        s: Math.max(win.startMs, start),
        e: Math.min(win.endMs, end),
        planned: e.type === "preventive",
        title: e.title.trim(),
        open,
        since: start,
        until: end,
      };
    })
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s);
  const out: StopWindow[] = [];
  for (const f of raw) {
    const last = out[out.length - 1];
    if (last && f.s <= last.e) {
      last.e = Math.max(last.e, f.e);
      last.open = last.open || f.open;
      last.since = Math.min(last.since, f.since);
      last.until = Math.max(last.until, f.until);
      // A fault names the window before any preventive job inside it.
      if (last.planned && !f.planned) last.titles.unshift(f.title);
      else if (!last.titles.includes(f.title)) last.titles.push(f.title);
      last.planned = last.planned && f.planned;
    } else {
      out.push({
        s: f.s,
        e: f.e,
        planned: f.planned,
        titles: [f.title],
        open: f.open,
        since: f.since,
        until: f.until,
      });
    }
  }
  return out;
}

export interface BuildPlantInput {
  nowMs: number;
  /** The production day to show; default: the one that contains nowMs. */
  day?: string;
  lines: PlantLineInput[];
  /** Events that touch the production day (any line of the company). */
  events: PlantEvent[];
  /** Entries of the RECENT_DAYS days up to the day shown, already normalised. */
  entries: PlantEntry[];
  closures: PlantClosure[];
  /** kg per minute at capacity, per line id. */
  rates: Map<string, number | null>;
  /** Packing machine names by id, for the feed. */
  machineNames?: Map<string, string>;
}

export function buildPlant(input: BuildPlantInput): PlantModel {
  const { nowMs, entries, closures, rates } = input;
  const win = input.day ? windowOf(input.day) : productionDay(nowMs);
  const cap = Math.max(win.startMs, Math.min(nowMs, win.endMs));
  const isToday = nowMs < win.endMs;
  const feed: FeedItem[] = [];
  const reported = input.events.some((e) => {
    const s = new Date(e.started_at).getTime();
    return s >= win.startMs && s < win.endMs;
  });

  const lines: PlantLine[] = input.lines.map((l) => {
    const evs = input.events.filter((e) => e.line_id === l.id);
    const startedToday = evs.some((e) => {
      const s = new Date(e.started_at).getTime();
      return s >= win.startMs && s < win.endMs;
    });
    const { sched, offReason, hours } = schedule(
      l.id,
      entries,
      closures,
      win,
      startedToday,
      !isToday,
    );
    const windows = stopWindows(evs, win, nowMs);
    const minor = evs
      .filter((e) => e.type !== "preventive" && (!e.stops_line || !!e.machine_id))
      .map((e) => {
        const s = new Date(e.started_at).getTime();
        const open = !e.resolved_at;
        return {
          s,
          e: open ? nowMs : new Date(e.resolved_at as string).getTime(),
          title: e.title.trim(),
          machine: !!e.machine_id,
          open,
          machineId: e.machine_id,
          id: e.id,
        };
      });

    const mine = entries.filter((e) => e.line_id === l.id);
    const todays = mine.filter((e) => e.entry_date === win.day);
    const before = mine.filter((e) => e.entry_date < win.day);
    const lastDay = before.reduce((m, e) => (e.entry_date > m ? e.entry_date : m), "");
    const lastRows = before.filter((e) => e.entry_date === lastDay);
    const sum = (rows: PlantEntry[], k: "making_actual" | "making_plan") =>
      rows.reduce((a, e) => a + (Number(e[k]) || 0), 0);

    for (const w of windows) {
      feed.push({
        key: `w${l.id}${w.s}`,
        t: w.s,
        kind: w.planned ? "preventive" : "stop",
        lineId: l.id,
        title: w.planned ? `${l.name} · preventive work` : `${l.name} stopped`,
        detail: [
          w.since < win.startMs ? "carried over from before 08:00" : "",
          w.until > win.endMs ? "ran on past 08:00" : "",
        ]
          .filter(Boolean)
          .join(" · "),
        fault: w.titles.join(" · "),
      });
      // Resumed inside this day (a stop running past 08:00 resumes in the next one).
      if (!w.open && w.until <= cap) {
        feed.push({
          key: `r${l.id}${w.e}`,
          t: w.e,
          kind: "resume",
          lineId: l.id,
          title: `${l.name} running again`,
          detail: w.planned
            ? `preventive work took ${minutesText((w.until - w.since) / MIN)}`
            : `${minutesText((w.until - w.since) / MIN)} stopped`,
          fault: null,
        });
      }
    }
    for (const m of minor) {
      if (m.s < win.startMs || m.s > cap) continue;
      const machine = m.machineId ? input.machineNames?.get(m.machineId) : null;
      feed.push({
        key: `m${m.id}`,
        t: m.s,
        kind: m.machine ? "machine" : "defect",
        lineId: l.id,
        title: m.machine
          ? `${l.name} · ${machine ?? "packing machine"} fault`
          : `${l.name} · fault, line kept running`,
        detail: "",
        fault: m.title,
      });
    }
    for (const e of todays) {
      const t = e.created_at ? new Date(e.created_at).getTime() : NaN;
      if (!Number.isFinite(t) || t < win.startMs || t > cap) continue;
      feed.push({
        key: `e${l.id}${e.shift}${t}`,
        t,
        kind: "entry",
        lineId: l.id,
        title: `${l.name} · ${e.shift === "DAY" ? "Full-day" : `Shift ${e.shift}`} entry saved`,
        detail: `${Math.round(Number(e.making_actual) || 0).toLocaleString("en-US")} kg made`,
        fault: null,
      });
    }

    return {
      id: l.id,
      name: l.name,
      color: l.color,
      ratePerMin: rates.get(l.id) ?? null,
      sched,
      offReason,
      hours,
      windows,
      minor: minor.map(({ s, e, title, machine, open }) => ({ s, e, title, machine, open })),
      last: lastDay
        ? { day: lastDay, made: sum(lastRows, "making_actual"), plan: sum(lastRows, "making_plan") }
        : null,
      entry:
        todays.length > 0
          ? {
              made: sum(todays, "making_actual"),
              plan: sum(todays, "making_plan"),
              entries: todays.length,
            }
          : null,
      stops: windows.filter((w) => !w.planned).length,
    };
  });

  // Shift changes, when at least one line is scheduled in that shift.
  for (const [name, [a]] of Object.entries(SHIFT_SPAN)) {
    const t = win.startMs + a * MIN;
    if (t > cap) continue;
    const n = lines.filter((l) => l.sched.some((s) => t >= s.s && t < s.e)).length;
    if (n === 0) continue;
    feed.push({
      key: `s${name}`,
      t,
      kind: "shift",
      lineId: null,
      title: `Shift ${name} started`,
      detail: `${n} line${n === 1 ? "" : "s"} scheduled`,
      fault: null,
    });
  }
  feed.sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));

  // An open window ends at "now", and now itself is still inside it.
  const inside = (x: { s: number; e: number; open: boolean }, t: number) =>
    t >= x.s && (t < x.e || x.open);

  /** Scheduled, lost and preventive minutes of a line up to t. */
  function minutes(l: PlantLine, t: number) {
    let schedMin = 0;
    let lostMin = 0;
    let plannedMin = 0;
    for (const s of l.sched) {
      const e = Math.min(s.e, t);
      if (e <= s.s) continue;
      schedMin += (e - s.s) / MIN;
      for (const x of l.windows) {
        const o = overlap(x, s.s, e) / MIN;
        if (x.planned) plannedMin += o;
        else lostMin += o;
      }
    }
    return { schedMin, lostMin, plannedMin, runMin: Math.max(0, schedMin - lostMin - plannedMin) };
  }
  // Minutes each line ran in the whole day: a finished day's entry is spread over them.
  const ranAll = new Map(lines.map((l) => [l.id, minutes(l, cap).runMin]));

  function lineAt(l: PlantLine, t: number): LineSnapshot {
    const w = l.windows.find((x) => inside(x, t)) ?? null;
    const scheduledNow = l.sched.some((s) => t >= s.s && t < s.e);
    const { schedMin, lostMin, plannedMin, runMin } = minutes(l, t);
    let kg: number | null = null;
    let kgKind: LineSnapshot["kgKind"] = null;
    if (!isToday && l.entry) {
      const all = ranAll.get(l.id) ?? 0;
      kg = all > 0 ? l.entry.made * Math.min(1, runMin / all) : t >= cap ? l.entry.made : 0;
      kgKind = "made";
    } else if (l.ratePerMin != null) {
      kg = l.ratePerMin * runMin;
      kgKind = "est";
    }
    const state: LineState = w
      ? w.planned
        ? "preventive"
        : "stopped"
      : scheduledNow
        ? "running"
        : "off";
    const offReason =
      state !== "off"
        ? null
        : (l.offReason ??
          (l.sched.some((s) => s.s > t)
            ? `Off shift · back at ${hhmm(l.sched.find((s) => s.s > t)!.s)}`
            : "Off shift"));
    return {
      id: l.id,
      state,
      window: w,
      offReason,
      schedMin,
      lostMin,
      plannedMin,
      runMin,
      kg,
      kgKind,
      defects: l.minor.filter((m) => !m.machine && inside(m, t)).length,
      machinesDown: l.minor.filter((m) => m.machine && inside(m, t)).length,
    };
  }

  return {
    win,
    nowMs,
    isToday,
    cap,
    reported,
    lines,
    feed,
    at(tIn: number): PlantSnapshot {
      const t = Math.max(win.startMs, Math.min(tIn, cap));
      const snaps = lines.map((l) => lineAt(l, t));
      const name = (id: string) => lines.find((l) => l.id === id)?.name ?? "";
      const schedMin = snaps.reduce((a, s) => a + s.schedMin, 0);
      const lostMin = snaps.reduce((a, s) => a + s.lostMin, 0);
      const plannedMin = snaps.reduce((a, s) => a + s.plannedMin, 0);
      const base = schedMin - plannedMin;
      const on = snaps.filter((s) => s.state !== "off");
      return {
        t,
        lines: snaps,
        scheduled: on.length,
        running: snaps.filter((s) => s.state === "running").length,
        stopped: snaps.filter((s) => s.state === "stopped").map((s) => name(s.id)),
        preventive: snaps.filter((s) => s.state === "preventive").map((s) => name(s.id)),
        off: snaps.length - on.length,
        lostMin,
        plannedMin,
        schedMin,
        availability: base > 0 ? (base - lostMin) / base : null,
        kg: snaps.reduce((a, s) => a + (s.kg ?? 0), 0),
        madeLines: snaps.filter((s) => s.kgKind === "made").length,
        estLines: snaps.filter((s) => s.kgKind === "est" && s.schedMin > 0).length,
        noRate: snaps.filter((s) => s.kgKind === null && s.schedMin > 0).length,
      };
    },
  };
}
