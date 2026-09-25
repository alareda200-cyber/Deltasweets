// The Settings page's section list — shared by the route's validateSearch
// (/settings?section=<id>), the desktop sidebar and the mobile list. The ids
// are a contract with the mobile "More" tab, which deep-links into them; do
// not rename one without updating that tab too.
export const SECTION_IDS = [
  "lines",
  "areas",
  "reasons",
  "fields",
  "technicians",
  "departments",
  "categories",
  "types",
  "severity",
  "rootCauses",
  "faultTitles",
  "areaOwners",
  "reliability",
  "backup",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export function isSectionId(v: unknown): v is SectionId {
  return typeof v === "string" && (SECTION_IDS as readonly string[]).includes(v);
}

export interface SectionMeta {
  group: string;
  title: string;
  description: string;
  // Extra words the "Find a setting" box matches on, beyond the title.
  keywords: string;
  // Changes here rewrite history (past events, restored rows, MTBF/MTTR).
  careful?: boolean;
}

export const SECTION_META: Record<SectionId, SectionMeta> = {
  lines: {
    group: "Production setup",
    title: "Production lines",
    description:
      "The lines supervisors report on. Each line has its own daily entries and its own extra fields.",
    keywords: "line colour code",
  },
  areas: {
    group: "Production setup",
    title: "Production areas",
    description:
      "Areas of the plant. Each active area gets its own area-owner picker on the Daily entry screen.",
    keywords: "area cooking depositing packing",
  },
  reasons: {
    group: "Production setup",
    title: "Downtime reasons",
    description: "What supervisors pick in the downtime log.",
    keywords: "downtime reason stop planned unplanned",
  },
  fields: {
    group: "Production setup",
    title: "Line fields",
    description:
      "Extra fields for one line, beyond the standard entry form (for example Cooking Brix or Mogul speed).",
    keywords: "custom fields extra",
  },
  technicians: {
    group: "Maintenance lists",
    title: "Technicians",
    description:
      "Maintenance staff you can assign to events. Only active technicians can be newly assigned.",
    keywords: "staff engineer maintenance people",
  },
  departments: {
    group: "Maintenance lists",
    title: "Departments",
    description:
      "Who is responsible for a downtime reason or an area owner. Each department belongs to a department category.",
    keywords: "department mechanical electrical preventive",
  },
  categories: {
    group: "Maintenance lists",
    title: "Department categories",
    description:
      "Dashboards filter by category (for example Maintenance), never by a single department — a new department joins a category and shows up automatically.",
    keywords: "category group",
  },
  types: {
    group: "Maintenance lists",
    title: "Downtime types",
    description: "Planned or unplanned — the classification each downtime reason carries.",
    keywords: "planned unplanned type",
  },
  severity: {
    group: "Maintenance lists",
    title: "Severity levels",
    description:
      "How serious a downtime reason is. Used to rank the Pareto and for the Critical minutes card.",
    keywords: "critical major minor severity",
  },
  rootCauses: {
    group: "Maintenance lists",
    title: "Root causes",
    description:
      "Why a fault happened, as opposed to which part it was (“Servo 1003”). Optional on every event.",
    keywords: "why cause fault",
  },
  faultTitles: {
    group: "Maintenance lists",
    title: "Fault titles",
    description:
      "Every title used on a maintenance event, plant-wide. Rename or merge to keep repeat-fault reporting clean — this rewrites past events.",
    keywords: "rename merge title fault events",
    careful: true,
  },
  areaOwners: {
    group: "People",
    title: "Area owners",
    description: "People who can be named as the owner of a production area on a daily entry.",
    keywords: "owner people employee",
  },
  reliability: {
    group: "System",
    title: "Reliability window",
    description:
      "The first date MTBF and MTTR count from, and the date root-cause recording started.",
    keywords: "mtbf mttr window start date root cause tracking",
    careful: true,
  },
  backup: {
    group: "System",
    title: "Backup and restore",
    description:
      "Export the master data to a file, or restore it from one. A restore overwrites rows with the same id.",
    keywords: "export import restore backup file json",
    careful: true,
  },
};

// Desktop sidebar grouping (the Settings board).
export const DESKTOP_GROUPS: { title: string; items: (SectionId | "users")[] }[] = [
  { title: "Production setup", items: ["lines", "areas", "reasons", "fields"] },
  {
    title: "Maintenance lists",
    items: [
      "technicians",
      "departments",
      "categories",
      "types",
      "severity",
      "rootCauses",
      "faultTitles",
    ],
  },
  { title: "People", items: ["areaOwners", "users"] },
  { title: "System", items: ["reliability", "backup"] },
];

// Mobile list grouping (the SettingsMobile board): the three sections that
// rewrite history are pulled into their own "careful" group at the bottom.
export const MOBILE_GROUPS: { title: string; items: (SectionId | "users")[]; careful?: boolean }[] =
  [
    { title: "Production setup", items: ["lines", "areas", "reasons", "fields"] },
    {
      title: "Maintenance lists",
      items: ["technicians", "departments", "categories", "types", "severity", "rootCauses"],
    },
    { title: "People", items: ["areaOwners", "users"] },
    {
      title: "Careful — changes history",
      items: ["faultTitles", "backup", "reliability"],
      careful: true,
    },
  ];
