// A small .xlsx reader for the FG workbook upload on Plan adherence: no
// library, so nothing new to install. An .xlsx file is a zip of XML parts;
// this reads the parts it needs (workbook, its relationships, shared strings
// and the sheets asked for) and returns each sheet's cells by row.
//   - Values are what Excel last saved in the file (formulas are not worked
//     out again), which is what the person saw when they saved it.
//   - Dates come back as Excel day numbers; excelDate() turns one into a day.
// Zip entries are "stored" or "deflate"; deflate is unpacked with the
// browser's DecompressionStream.

export type Cell = string | number | boolean | null;
/** A sheet's rows by row number (1-based), each a map of column letter → value. */
export type SheetRows = Map<number, Map<string, Cell>>;

interface ZipEntry {
  name: string;
  method: number;
  offset: number;
  size: number;
}

function zipEntries(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: signature 0x06054b50, within the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This isn't an Excel .xlsx file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("The .xlsx file is damaged.");
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    // The data starts after the local header, whose name/extra lengths can
    // differ from the central directory's.
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    out.push({ name, method, offset: local + 30 + lNameLen + lExtraLen, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : ENT[e],
  );
}
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
};
/** All the text of <t> elements inside a piece of XML (rich text runs joined). */
function texts(xml: string): string {
  let s = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += m[1];
  return unescapeXml(s);
}

export class Workbook {
  readonly sheetNames: string[];
  private readPart: (name: string) => Promise<string | null>;
  private sheetPath: Map<string, string>;
  private shared: string[];

  private constructor(
    readPart: (name: string) => Promise<string | null>,
    sheetNames: string[],
    sheetPath: Map<string, string>,
    shared: string[],
  ) {
    this.readPart = readPart;
    this.sheetNames = sheetNames;
    this.sheetPath = sheetPath;
    this.shared = shared;
  }

  static async open(data: ArrayBuffer | Uint8Array): Promise<Workbook> {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    const parts = new Map(zipEntries(buf).map((e) => [e.name, e]));
    const read = async (name: string) => {
      const e = parts.get(name);
      if (!e) return null;
      const raw = buf.subarray(e.offset, e.offset + e.size);
      const bytes = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
      if (!bytes) throw new Error(`Unsupported compression in ${name}.`);
      return new TextDecoder().decode(bytes);
    };
    const wbXml = await read("xl/workbook.xml");
    if (!wbXml) throw new Error("This isn't an Excel workbook.");
    const relsXml = (await read("xl/_rels/workbook.xml.rels")) ?? "";
    const rels = new Map<string, string>();
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = attr(m[0], "Id");
      const target = attr(m[0], "Target");
      if (id && target)
        rels.set(
          id,
          target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`,
        );
    }
    const names: string[] = [];
    const sheetPath = new Map<string, string>();
    for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
      const name = attr(m[0], "name");
      const rid = attr(m[0], "r:id");
      if (!name || !rid) continue;
      names.push(name);
      const path = rels.get(rid);
      if (path) sheetPath.set(name, path);
    }
    const sstXml = (await read("xl/sharedStrings.xml")) ?? "";
    const shared = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
    return new Workbook(read, names, sheetPath, shared);
  }

  /** A sheet's cells, or null when the workbook has no sheet by that name. */
  async sheet(name: string): Promise<SheetRows | null> {
    const path = this.sheetPath.get(name);
    if (!path) return null;
    const xml = await this.readPart(path);
    if (xml === null) return null;
    const rows: SheetRows = new Map();
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rnum = Number(attr(rm[0], "r"));
      if (!rm[2] || !rnum) continue;
      const row = new Map<string, Cell>();
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(`<c${cm[1]}>`, "r");
        const col = ref ? ref.replace(/\d+$/, "") : null;
        const body = cm[2];
        if (!col || !body) continue;
        const type = attr(`<c${cm[1]}>`, "t");
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: Cell = null;
        if (type === "s") value = v != null ? (this.shared[Number(v)] ?? null) : null;
        else if (type === "inlineStr") value = texts(body);
        else if (type === "str") value = v != null ? unescapeXml(v) : null;
        else if (type === "b") value = v === "1";
        else if (type === "e") value = null;
        else if (v != null && v !== "") value = Number(v);
        if (value !== null && value !== "") row.set(col, value);
      }
      if (row.size) rows.set(rnum, row);
    }
    return rows;
  }
}

/** Excel's day number → "YYYY-MM-DD" (the 1900 date system). */
export function excelDate(v: Cell): string | null {
  if (typeof v === "number" && v > 0 && v < 2958466) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}
