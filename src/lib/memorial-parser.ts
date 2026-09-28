/**
 * Extração e normalização de memoriais descritivos (pt-BR).
 * Puro, sem dependências — usado no servidor e no cliente.
 */

import { normalizeMemorialText } from "./lexicon";

export type ParsedSegment = {
  seq: number;
  from_vertex: string | null;
  to_vertex: string | null;
  bearing_text: string | null;
  azimuth_deg: number | null;
  distance_m: number | null;
  altitude_from_m: number | null;
  altitude_to_m: number | null;
  confrontante: string | null;
  raw_text: string;
};

/** Coordenada de vértice: geodésica (SIGEF) e/ou plana (UTM N/E). */
export type VertexCoord = {
  name: string;
  lon: number | null;
  lat: number | null;
  alt: number | null;
  north: number | null;
  east: number | null;
};

export type ParsedParcel = {
  label: string | null;
  area_m2: number | null;
  declared_perimeter_m: number | null;
  computed_perimeter_m: number | null;
  vertex_count: number;
  altitude_min_m: number | null;
  altitude_max_m: number | null;
  altitude_mean_m: number | null;
  confrontantes: string[];
  segments: ParsedSegment[];
  vertices: VertexCoord[];
  warnings: string[];
};


/** Converte "1.234,56" ou "1234.56" em número. */
export function parseNumber(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\s/g, "");
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Números vindos de OCR podem trazer letras no lugar de dígitos
 * (5,A7 em vez de 5,47). Corrige os sósias mais comuns e sinaliza.
 */
const OCR_DIGIT_TOKEN = String.raw`[\dOoDIlZzASsGTBbgq.,]+`;

const OCR_DIGITS: Record<string, string> = {
  O: "0", o: "0", D: "0",
  I: "1", l: "1",
  Z: "2", z: "2",
  A: "4",
  S: "5", s: "5",
  G: "6",
  T: "7",
  B: "8", b: "8",
  g: "9", q: "9",
};

export function parseNumberOcr(raw: string): { value: number | null; corrigido: string | null } {
  const direto = parseNumber(raw);
  if (direto !== null) return { value: direto, corrigido: null };
  const ajustado = raw.replace(/[A-Za-z]/g, (c) => OCR_DIGITS[c] ?? c);
  if (/[A-Za-z]/.test(ajustado)) return { value: null, corrigido: null };
  const value = parseNumber(ajustado);
  if (value === null) return { value: null, corrigido: null };
  return { value, corrigido: `"${raw.trim()}" lido como "${ajustado.trim()}"` };
}

function avisoOcr(fixes: string[]): string {
  return (
    `Correção de OCR aplicada em ${fixes.length} medida(s) com letra no lugar de dígito: ` +
    `${fixes.join("; ")}. Confira estes valores no documento original.`
  );
}

/** Graus/minutos/segundos -> graus decimais. */
export function dmsToDegrees(
  deg: number,
  min = 0,
  sec = 0,
): number {
  return deg + min / 60 + sec / 3600;
}

/**
 * Marcas de minuto e de segundo aceitas. O OCR troca a apóstrofe reta por
 * aspas tipográficas, acento agudo, crase etc.; sem tolerar essas variantes
 * os minutos eram descartados e o azimute virava grau cheio (falsa divergência).
 */
export const APOS = String.raw`'\u2019\u2018\u00B4\u0060\u02BC\u2032`;
export const SEC = String.raw`"\u201D\u201C\u2033\u02BA`;

const DMS_RE = new RegExp(
  String.raw`(\d{1,3})\s*(?:°|º|graus|g)\s*(?:(\d{1,2})\s*(?:[${APOS}]|min|m)\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:[${SEC}]|seg|s)?)?|(\d{1,2})(?![\d.,]))?`,
  "i",
);

/** Lê um azimute textual: "123°45'30\"" (minutos podem vir sem apóstrofe). */
export function parseAzimuthText(text: string): number | null {
  const m = DMS_RE.exec(text);
  if (!m) {
    const dec = /(\d{1,3}(?:[.,]\d+)?)\s*(?:°|º|graus)/i.exec(text);
    return dec ? parseNumber(dec[1]!) : null;
  }
  const d = Number(m[1]);
  const minRaw = m[2] ?? m[4];
  const mi = minRaw ? Number(minRaw) : 0;
  const se = m[3] ? (parseNumber(m[3]) ?? 0) : 0;
  const value = dmsToDegrees(d, mi, se);
  return Number.isFinite(value) ? value : null;
}


/** Converte rumo (NE/SE/SW/NW) em azimute. */
export function bearingToAzimuth(
  angleDeg: number,
  quadrant: string,
): number | null {
  const q = quadrant.toUpperCase().replace(/[^NSEWO]/g, "").replace(/O/g, "W");
  switch (q) {
    case "NE":
      return angleDeg;
    case "SE":
      return 180 - angleDeg;
    case "SW":
      return 180 + angleDeg;
    case "NW":
      return 360 - angleDeg;
    default:
      return null;
  }
}

export function normalizeAzimuth(a: number): number {
  const v = a % 360;
  return v < 0 ? v + 360 : v;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(sr|sra|srta|dr|dra|espolio|espólio|de|da|do|dos|das|e)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanConfrontante(raw: string): string | null {
  const s = raw
    .replace(/^\s*(com|as?|os?)\s+/i, "")
    .replace(/\b(a\s+)?(propriedade|imóvel|imovel|terreno|lote|gleba)\s+(de|da|do)\s+/i, "")
    .replace(/[;.]+\s*$/, "")
    .trim();
  if (!s || s.length < 2) return null;
  return s.slice(0, 200);
}

const AREA_RE =
  /área\s*(?:total|superficial|do\s+(?:imóvel|imovel|lote|terreno))?\s*(?:é|de|:|igual a)?\s*([\d.,]+)\s*(m²|m2|metros\s+quadrados|ha|hectares?|alqueires?)/i;
const PERIM_RE =
  /per[ií]metro\s*(?:total)?\s*(?:é|de|:|igual a)?\s*([\d.,]+)\s*(m|metros)\b/i;
const MATRICULA_RE = /matr[ií]cula\s*(?:n[ºo°.]*\s*)?([\d.\-/]*\d)/i;

/** Divide o corpo do memorial em trechos por vértice. */
function splitSegments(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ");
  const parts = normalized.split(
    /(?<!at[ée]\s)(?<!at[ée]\s(?:o|a))(?<!at[ée]\s(?:o|a)\s)(?=(?:deste|desse|daí|dai|do|partindo\s+do|segue(?:-se)?\s+do)?\s*(?:v[ée]rtice|ponto|marco|estaca)\s+[A-Z0-9][\w\-.]{0,12}\s*(?:,|\s)\s*(?:segue|deflete|confront|com\s+azimute|azimute|rumo|ruma|até|deste|distância|de\s+coordenadas|coordenadas))/i,
  );
  return parts.map((p) => p.trim()).filter((p) => p.length > 15);
}

const VERTEX_PAIR_RE =
  /(?:v[ée]rtice|ponto|marco|estaca)\s+([A-Z0-9][\w\-.]{0,12})[\s\S]{0,400}?(?:até|ao?|at[ée]\s+o)\s+(?:o\s+)?(?:v[ée]rtice|ponto|marco|estaca)\s+([A-Z0-9][\w\-.]{0,12})/i;
const VERTEX_SINGLE_RE =
  /(?:v[ée]rtice|ponto|marco|estaca)\s+([A-Z0-9][\w\-.]{0,12})/i;
const DIST_RE = /(?:dist[âa]ncia|extens[ãa]o|medindo|mede|percorre)\s*(?:de|:)?\s*([\d.,]+)\s*(m|metros|km)\b/i;
const DIST_FALLBACK_RE = /\b([\d.,]+)\s*(?:m|metros)\b/i;
const ALT_RE =
  /altitude[^0-9\-]{0,20}(-?[\d.,]+)\s*(?:m|metros)?/gi;
const AZ_RE = /azimute[^0-9]{0,20}([^,;]{2,40})/i;
const RUMO_RE =
  /rumo[^0-9A-Z]{0,15}([\d]{1,3}\s*(?:°|º|graus)[^A-Z]{0,20})\s*(NE|SE|SW|SO|NW|NO)/i;
const CONFRONT_RE =
  /confront(?:ando|a|ante|antes|ação)?\s*(?:-se)?\s*(?:com|:)\s*([^,;.]{2,140})/i;

// --- Coordenadas de vértice -------------------------------------------------
const UTM_NE_RE =
  /\bN(?:orte)?\s*[:=]?\s*(\d{1,2}[.\s]?\d{3}[.\s]?\d{3}(?:[.,]\d+)?)\s*m?\b[\s,;]*(?:e\s*)?\bE(?:ste|Leste)?\s*[:=]?\s*(\d{3}[.\s]?\d{3}(?:[.,]\d+)?)/i;
const UTM_EN_RE =
  /\bE(?:ste|Leste)?\s*[:=]?\s*(\d{3}[.\s]?\d{3}(?:[.,]\d+)?)\s*m?\b[\s,;]*(?:e\s*)?\bN(?:orte)?\s*[:=]?\s*(\d{1,2}[.\s]?\d{3}[.\s]?\d{3}(?:[.,]\d+)?)/i;
const LAT_RE =
  /\blat(?:itude)?\s*[:=]?\s*(-?\d{1,3}\s*(?:[°ºo]\s*\d{1,2}\s*['\u2019\u2018\u00B4\u0060\u2032]\s*[\d.,]+\s*["\u201D\u2033]?\s*[NSns]?|[.,]\d+)\s*[NSns]?)/i;
const LON_RE =
  /\blong?(?:itude)?\s*[:=]?\s*(-?\d{1,3}\s*(?:[°ºo]\s*\d{1,2}\s*['\u2019\u2018\u00B4\u0060\u2032]\s*[\d.,]+\s*["\u201D\u2033]?\s*[EWOewo]?|[.,]\d+)\s*[EWOewo]?)/i;

/** Converte "23°45'12,3\" S" ou "-23,7534" em grau decimal com sinal. */
export function parseGeoCoord(raw: string): number | null {
  const s = raw.trim();
  const hemi = /([NSEWOnsewo])\s*$/.exec(s)?.[1]?.toUpperCase() ?? null;
  const dms = /(-?\d{1,3})\s*[°ºo]\s*(\d{1,2})\s*['\u2019\u2018\u00B4\u0060\u2032]?\s*([\d.,]+)?/.exec(s);
  let value: number | null = null;
  if (dms) {
    const d = Number(dms[1]);
    const m = Number(dms[2]);
    const sec = dms[3] ? (parseNumber(dms[3]) ?? 0) : 0;
    value = Math.abs(d) + m / 60 + sec / 3600;
    if (d < 0) value = -value;
  } else {
    value = parseNumber(s.replace(/[^\d.,-]/g, ""));
  }
  if (value === null || !Number.isFinite(value)) return null;
  if (hemi === "S" || hemi === "W" || hemi === "O") value = -Math.abs(value);
  return Number(value.toFixed(8));
}

function extractCoords(chunk: string): {
  lon: number | null;
  lat: number | null;
  north: number | null;
  east: number | null;
} {
  let north: number | null = null;
  let east: number | null = null;
  const ne = UTM_NE_RE.exec(chunk);
  if (ne) {
    north = parseNumber(ne[1]!.replace(/\s/g, ""));
    east = parseNumber(ne[2]!.replace(/\s/g, ""));
  } else {
    const en = UTM_EN_RE.exec(chunk);
    if (en) {
      east = parseNumber(en[1]!.replace(/\s/g, ""));
      north = parseNumber(en[2]!.replace(/\s/g, ""));
    }
  }
  const latM = LAT_RE.exec(chunk);
  const lonM = LON_RE.exec(chunk);
  return {
    lat: latM ? parseGeoCoord(latM[1]!) : null,
    lon: lonM ? parseGeoCoord(lonM[1]!) : null,
    north,
    east,
  };
}

/** Reconstitui hifenizações e sinais quebrados por fim de linha do PDF. */
function repairLineBreaks(text: string): string {
  // Remove linhas curtas sem dígitos (ruído típico de OCR, ex.: "O", "« í")
  const semRuido = text
    .split(/\r?\n/)
    .filter((l) => {
      const s = l.trim();
      if (!s) return true;
      return !(s.length <= 3 && !/\d/.test(s));
    })
    .join("\n");
  return semRuido
    .replace(/\s+/g, " ")
    .replace(/([A-Za-z0-9])-\s+(?=[A-Za-z0-9])/g, "$1-")
    .replace(/([(:,]\s*)-\s+(?=\d)/g, "$1-");
}

const AREA_LABEL_RE =
  /[áa]rea[^\n:]{0,80}?:\s*([\d.,]+)\s*(m²|m2|metros\s+quadrados|ha|hectares?|alqueires?)?/i;
const PERIM_LABEL_RE =
  /per[ií]metro[^\n:]{0,60}?:\s*([\d.,]+)\s*(km|m|metros)?/i;

/**
 * Lê um valor numérico rotulado em layout de TABELA:
 * - "Área total (ha)   20,1409"       (mesma linha, sem dois-pontos)
 * - "Área total (ha) | 20,1409"       (colunas separadas por pipe/tab)
 * - "Perímetro (m)\n2.031,45"         (rótulo numa linha, valor na seguinte)
 */
function tableLabeledNumber(
  raw: string,
  labelRe: RegExp,
): { value: number | null; context: string } {
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = labelRe.exec(line);
    if (!m) continue;
    const rest = line.slice((m.index ?? 0) + m[0].length);
    const inline = /(-?\d[\d.,]*)/.exec(rest);
    if (inline) {
      const v = parseNumber(inline[1]!);
      if (v !== null) return { value: v, context: line };
    }
    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
      const nx = lines[j]!.trim();
      if (!nx) continue;
      const only =
        /^[:|\s]*(-?\d[\d.,]*)\s*(m²|m2|metros\s+quadrados|ha|hectares?|alqueires?|km|m|metros)?\b/i.exec(
          nx,
        );

      if (only) {
        const v = parseNumber(only[1]!);
        if (v !== null) return { value: v, context: `${line} ${nx}` };
      }
      break;
    }
  }
  return { value: null, context: "" };
}

function areaUnitFrom(context: string): string {
  const c = context.toLowerCase();
  if (/alqueire/.test(c)) return "alqueire";
  if (/\bha\b|hectare/.test(c)) return "ha";
  return "m2";
}

function applyAreaUnit(value: number, unit: string): number {
  if (unit.startsWith("ha") || unit.startsWith("hectare")) return value * 10000;
  if (unit.startsWith("alqueire")) return value * 24200;
  return value;
}

/** Área em m², em texto corrido ou tabela — "Área Total (hectare): 20,1409". */
function extractArea(flat: string, raw = flat): number | null {
  const direct = AREA_RE.exec(flat);
  if (direct) {
    const v = parseNumber(direct[1]!);
    return v === null ? null : applyAreaUnit(v, direct[2]!.toLowerCase());
  }
  const labeled = AREA_LABEL_RE.exec(flat);
  if (labeled) {
    const v = parseNumber(labeled[1]!);
    if (v !== null) {
      const unit =
        (labeled[2] ?? "").toLowerCase() ||
        areaUnitFrom(flat.slice(Math.max(0, labeled.index), labeled.index + 90));
      return applyAreaUnit(v, unit);
    }
  }
  const table = tableLabeledNumber(raw, /[áa]rea(?:\s+(?:total|superficial|do\s+\S+))?\s*(?:\([^)]*\))?/i);
  if (table.value === null) return null;
  return applyAreaUnit(table.value, areaUnitFrom(table.context));
}

/** Perímetro declarado em metros, em texto corrido ou tabela. */
function extractPerimeter(flat: string, raw = flat): number | null {
  const direct = PERIM_RE.exec(flat);
  if (direct) return parseNumber(direct[1]!);
  const labeled = PERIM_LABEL_RE.exec(flat);
  if (labeled) {
    const value = parseNumber(labeled[1]!);
    if (value !== null)
      return (labeled[2] ?? "").toLowerCase() === "km" ? value * 1000 : value;
  }
  const table = tableLabeledNumber(raw, /per[ií]metro(?:\s+total)?\s*(?:\([^)]*\))?/i);
  if (table.value === null) return null;
  return /\bkm\b/i.test(table.context) ? table.value * 1000 : table.value;
}



type StructuredParse = {
  segments: ParsedSegment[];
  coords: Map<string, VertexCoord>;
  warnings?: string[];
};

const COORD_DMS = String.raw`-?\d{1,3}\s*[°ºo]\s*\d{1,2}\s*[${APOS}]\s*[\d.,]+\s*[${SEC}]?`;

/** Memorial SIGEF/INCRA em tabela: código, long, lat, altitude, vante, azimute, distância. */
const SIGEF_ROW_RE = new RegExp(
  String.raw`^\s*([A-Z0-9][\w\-.]{2,20})\s+(${COORD_DMS})\s+(${COORD_DMS})\s+(-?[\d.,]+)\s+([A-Z0-9][\w\-.]{2,20})\s+(\d{1,3}\s*[°ºo]\s*\d{1,2}\s*[${APOS}]?(?:\s*[\d.,]+\s*[${SEC}])?)\s+(${OCR_DIGIT_TOKEN})\s*(.*)$`,
  "i",
);

function parseSigefTable(rawText: string): StructuredParse | null {
  const segments: ParsedSegment[] = [];
  const coords = new Map<string, VertexCoord>();
  const ocrFixes: string[] = [];
  const altByVertex = new Map<string, number | null>();

  for (const line of rawText.split(/\r?\n/)) {
    const m = SIGEF_ROW_RE.exec(line.trim());
    if (!m) continue;
    const [, from, lonRaw, latRaw, altRaw, to, azRaw, distRaw, tail] = m;
    const key = from!.toUpperCase();
    const alt = parseNumber(altRaw!);
    altByVertex.set(key, alt);
    coords.set(key, {
      name: key,
      lon: parseGeoCoord(lonRaw!),
      lat: parseGeoCoord(latRaw!),
      alt,
      north: null,
      east: null,
    });
    const az = parseAzimuthText(azRaw!);
    const dist = parseNumberOcr(distRaw!);
    if (dist.corrigido) ocrFixes.push(dist.corrigido);
    const confrontante = tail
      ? cleanConfrontante(tail.split("|").pop()!.trim())
      : null;
    segments.push({
      seq: segments.length + 1,
      from_vertex: from!,
      to_vertex: to!,
      bearing_text: azRaw!.trim(),
      azimuth_deg: az === null ? null : normalizeAzimuth(az),
      distance_m: dist.value,
      altitude_from_m: alt,
      altitude_to_m: null,
      confrontante,
      raw_text: line.trim().slice(0, 600),
    });
  }

  if (segments.length < 3) return null;
  segments.forEach((s) => {
    if (s.to_vertex) s.altitude_to_m = altByVertex.get(s.to_vertex.toUpperCase()) ?? null;
  });
  return {
    segments,
    coords,
    ...(ocrFixes.length ? { warnings: [avisoOcr(ocrFixes)] } : {}),
  };
}

// --- Tabelas genéricas de grandezas ----------------------------------------
// Suporta planilhas/tabelas de PDF com cabeçalho, em qualquer ordem de colunas,
// separadas por pipe, tabulação, ponto-e-vírgula ou espaçamento.

type ColKind =
  | "vertex"
  | "vante"
  | "lon"
  | "lat"
  | "alt"
  | "north"
  | "east"
  | "azimuth"
  | "distance"
  | "confrontante"
  | "ignore";

const HEADER_KINDS: { re: RegExp; kind: ColKind }[] = [
  { re: /confront|lindeir|vizinh/i, kind: "confrontante" },
  { re: /vante|seguinte|pr[óo]ximo|para\s+o\s+v[ée]rtice|v[ée]rtice\s+final/i, kind: "vante" },
  { re: /v[ée]rtice|esta[çc][ãa]o|ponto|marco|estaca|c[óo]digo/i, kind: "vertex" },
  { re: /longitude|\blon\b|\blong\b/i, kind: "lon" },
  { re: /latitude|\blat\b/i, kind: "lat" },
  { re: /altitude|altura|cota|\balt\b|\bh\s*\(m\)/i, kind: "alt" },
  { re: /norte|\bn\s*\(m\)|^n$/i, kind: "north" },
  { re: /este|leste|\be\s*\(m\)|^e$/i, kind: "east" },
  { re: /azimute|rumo|dire[çc][ãa]o/i, kind: "azimuth" },
  { re: /dist[âa]ncia|extens[ãa]o|comprimento|medida/i, kind: "distance" },
];

const DMS_TOKEN_RE = new RegExp(
  String.raw`-?\d{1,3}\s*[°ºo]\s*\d{1,2}\s*[${APOS}]\s*(?:[\d.,]+\s*[${SEC}]?)?\s*[NSEWOnsewo]?`,
  "g",
);

/** Divide a linha em células, preservando tokens em grau/minuto/segundo. */
function tokenizeRow(line: string): string[] {
  const dms: string[] = [];
  const masked = line.replace(DMS_TOKEN_RE, (m) => {
    dms.push(m.trim());
    return `\u0001${dms.length - 1}\u0001`;
  });
  const explicit = /[|;\t]|\s{2,}/.test(masked);
  const parts = masked
    .split(explicit ? /\s*[|;\t]\s*|\s{2,}/ : /\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.map((p) =>
    p.replace(/\u0001(\d+)\u0001/g, (_, i: string) => dms[Number(i)] ?? ""),
  );
}

function headerKinds(line: string): ColKind[] | null {
  const cells = tokenizeRow(line);
  if (cells.length < 3) return null;
  const kinds = cells.map<ColKind>((c) => {
    for (const h of HEADER_KINDS) if (h.re.test(c)) return h.kind;
    return "ignore";
  });
  // Colunas duplicadas: a 2ª coluna de vértice é o vértice de vante.
  let vistoVertex = false;
  const temVante = kinds.includes("vante");
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] !== "vertex") continue;
    if (!vistoVertex) vistoVertex = true;
    else kinds[i] = temVante ? "ignore" : "vante";
  }
  const useful = kinds.filter((k) => k !== "ignore").length;
  return useful >= 3 ? kinds : null;

}

const isCode = (t: string) => /[A-Za-z]/.test(t) && t.length <= 24;

/** Linhas de rótulo/metadados que nunca são linhas de dados de vértice. */
const META_LINE_RE =
  /[áa]rea|per[íi]metro|matr[íi]cula|im[óo]vel|munic[íi]p|comarca|propriet|respons|t[ée]cnic|cart[óo]rio|data\b|zona|datum|escala|fl\.|folha|registro|c[óo]digo\s+do/i;

/** Código de vértice plausível: contém dígito ou é uma sigla curta. */
const isVertexCode = (t: string) =>
  isCode(t) && (/\d/.test(t) || t.replace(/[^A-Za-z]/g, "").length <= 3);


type TableRow = {
  vertex: string | null;
  vante: string | null;
  lon: number | null;
  lat: number | null;
  alt: number | null;
  north: number | null;
  east: number | null;
  azimuth: number | null;
  bearing_text: string | null;
  distance: number | null;
  confrontante: string | null;
  raw: string;
};

function rowFromKinds(cells: string[], kinds: ColKind[], raw: string): TableRow | null {
  const row: TableRow = {
    vertex: null, vante: null, lon: null, lat: null, alt: null,
    north: null, east: null, azimuth: null, bearing_text: null,
    distance: null, confrontante: null, raw,
  };
  kinds.forEach((kind, i) => {
    const cell = cells[i];
    if (!cell) return;
    switch (kind) {
      case "vertex": row.vertex = cell; break;
      case "vante": row.vante = cell; break;
      case "lon": row.lon = parseGeoCoord(cell); break;
      case "lat": row.lat = parseGeoCoord(cell); break;
      case "alt": row.alt = parseNumber(cell.replace(/[^\d.,-]/g, "")); break;
      case "north": row.north = parseNumber(cell.replace(/[^\d.,-]/g, "")); break;
      case "east": row.east = parseNumber(cell.replace(/[^\d.,-]/g, "")); break;
      case "azimuth": {
        row.bearing_text = cell;
        const quad = /(NE|SE|SW|SO|NW|NO)/i.exec(cell);
        const ang = parseAzimuthText(cell);
        row.azimuth =
          ang === null
            ? null
            : quad
              ? (bearingToAzimuth(ang, quad[1]!) ?? null)
              : ang;
        if (row.azimuth !== null) row.azimuth = normalizeAzimuth(row.azimuth);
        break;
      }
      case "distance": row.distance = parseNumber(cell.replace(/[^\d.,-]/g, "")); break;
      case "confrontante": row.confrontante = cleanConfrontante(cell); break;
      default: break;
    }
  });
  if (!row.vertex || !isCode(row.vertex)) return null;
  const hasData =
    row.lat !== null || row.lon !== null || row.north !== null ||
    row.east !== null || row.alt !== null || row.distance !== null ||
    row.azimuth !== null;
  return hasData ? row : null;
}

/** Linha de tabela sem cabeçalho: infere colunas pelo tipo de cada célula. */
function rowByHeuristics(cells: string[], raw: string): TableRow | null {
  if (cells.length < 3) return null;
  if (META_LINE_RE.test(raw)) return null;

  const row: TableRow = {
    vertex: null, vante: null, lon: null, lat: null, alt: null,
    north: null, east: null, azimuth: null, bearing_text: null,
    distance: null, confrontante: null, raw,
  };
  const geoDms: string[] = [];
  const plainNums: number[] = [];
  const codes: string[] = [];
  let azCell: string | null = null;

  for (const cell of cells) {
    if (/[°ºo]\s*\d{1,2}\s*['′]/.test(cell)) {
      if (/[NSEWOnsewo]\s*$/.test(cell)) geoDms.push(cell);
      else if (azCell === null) azCell = cell;
      else geoDms.push(cell);
      continue;
    }
    const num = parseNumber(cell.replace(/[^\d.,-]/g, ""));
    if (num !== null && /^[^A-Za-z]*$/.test(cell)) plainNums.push(num);
    else if (isCode(cell)) codes.push(cell);
  }

  if (geoDms.length >= 2) {
    const lonRaw = geoDms.find((c) => /[EWOewo]\s*$/.test(c)) ?? geoDms[0]!;
    const latRaw = geoDms.find((c) => /[NSns]\s*$/.test(c)) ?? geoDms[1]!;
    row.lon = parseGeoCoord(lonRaw);
    row.lat = parseGeoCoord(latRaw);
  }
  for (const n of plainNums) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000 && row.north === null) row.north = n;
    else if (abs >= 100_000 && abs < 1_000_000 && row.east === null) row.east = n;
    else if (row.alt === null && abs <= 9000) row.alt = n;
    else if (row.distance === null && abs <= 100_000) row.distance = n;
  }
  if (azCell) {
    row.bearing_text = azCell;
    const ang = parseAzimuthText(azCell);
    if (ang !== null) row.azimuth = normalizeAzimuth(ang);
  }
  row.vertex = codes.find(isVertexCode) ?? null;
  row.vante = codes.filter(isVertexCode)[1] ?? null;
  if (!row.vertex) return null;

  const hasData =
    row.lat !== null || row.lon !== null || row.north !== null ||
    row.east !== null || row.alt !== null;
  return hasData ? row : null;
}

const R_EARTH = 6378137;

/** Azimute e distância entre dois vértices a partir das coordenadas. */
function geometryBetween(
  a: VertexCoord,
  b: VertexCoord,
): { azimuth: number | null; distance: number | null } {
  if (a.north !== null && a.east !== null && b.north !== null && b.east !== null) {
    const dn = b.north - a.north;
    const de = b.east - a.east;
    const distance = Math.hypot(dn, de);
    const azimuth = normalizeAzimuth((Math.atan2(de, dn) * 180) / Math.PI);
    return { azimuth: Number(azimuth.toFixed(6)), distance: Number(distance.toFixed(3)) };
  }
  if (a.lat !== null && a.lon !== null && b.lat !== null && b.lon !== null) {
    const rad = Math.PI / 180;
    const φ1 = a.lat * rad;
    const φ2 = b.lat * rad;
    const dλ = (b.lon - a.lon) * rad;
    const dφ = φ2 - φ1;
    const x = dλ * Math.cos((φ1 + φ2) / 2);
    const distance = Math.hypot(dφ, x) * R_EARTH;
    const y = Math.sin(dλ) * Math.cos(φ2);
    const xb = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
    const azimuth = normalizeAzimuth((Math.atan2(y, xb) * 180) / Math.PI);
    return { azimuth: Number(azimuth.toFixed(6)), distance: Number(distance.toFixed(3)) };
  }
  return { azimuth: null, distance: null };
}

/**
 * Tabela de grandezas (com ou sem cabeçalho): lê vértices, coordenadas
 * geodésicas ou UTM, altitude, azimute, distância e confrontante.
 * Quando a tabela só traz coordenadas, azimute e distância são calculados.
 */
function parseMeasureTable(rawText: string): StructuredParse | null {
  const lines = rawText.split(/\r?\n/);
  let kinds: ColKind[] | null = null;
  const rows: TableRow[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length < 8) continue;
    const maybeHeader = headerKinds(line);
    if (maybeHeader && !/\d{1,3}\s*[°ºo]/.test(line)) {
      kinds = maybeHeader;
      continue;
    }
    const cells = tokenizeRow(line);
    const row = kinds
      ? (rowFromKinds(cells, kinds, line) ?? rowByHeuristics(cells, line))
      : rowByHeuristics(cells, line);
    if (row) rows.push(row);
  }

  if (rows.length < 3) return null;

  const coords = new Map<string, VertexCoord>();
  for (const r of rows) {
    const key = r.vertex!.toUpperCase();
    const prev = coords.get(key);
    coords.set(key, {
      name: key,
      lon: r.lon ?? prev?.lon ?? null,
      lat: r.lat ?? prev?.lat ?? null,
      alt: r.alt ?? prev?.alt ?? null,
      north: r.north ?? prev?.north ?? null,
      east: r.east ?? prev?.east ?? null,
    });
  }

  const segments: ParsedSegment[] = [];
  rows.forEach((r, i) => {
    const from = r.vertex!;
    const to = r.vante ?? rows[(i + 1) % rows.length]!.vertex!;
    if (!to || to.toUpperCase() === from.toUpperCase()) return;
    const a = coords.get(from.toUpperCase())!;
    const b = coords.get(to.toUpperCase());
    const derived = b ? geometryBetween(a, b) : { azimuth: null, distance: null };
    segments.push({
      seq: segments.length + 1,
      from_vertex: from,
      to_vertex: to,
      bearing_text: r.bearing_text,
      azimuth_deg: r.azimuth ?? derived.azimuth,
      distance_m: r.distance ?? derived.distance,
      altitude_from_m: a.alt,
      altitude_to_m: b?.alt ?? null,
      confrontante: r.confrontante,
      raw_text: r.raw.slice(0, 600),
    });
  });

  return segments.length >= 3 ? { segments, coords } : null;
}



/** Memorial em prosa: "108°57' e 18,57 m até o vértice X, (Longitude: ..., Latitude: ... e Altitude: ...)". */
const SEP = String.raw`\s*(?:,|;|\be\b)?\s*`;
/**
 * O OCR frequentemente troca o símbolo de grau por um dígito ou letra parecida
 * (9, 0, o, O, q, *) e omite a aspa de segundos. Sem tolerar essas variantes o
 * trecho inteiro deixava de ser reconhecido e provocava efeito dominó nas
 * linhas seguintes.
 */
const DEG_OCR = String.raw`[°º\u00BA\u02DA\u00B0oO0q9*]`;
const PROSE_SEG_RE = new RegExp(
  String.raw`(\d{1,3}\s*${DEG_OCR}\s*\d{1,2}(?:\s*[${APOS}](?:\s*[\d.,]+\s*[${SEC}]?)?)?)\s*(?:e|,)\s*(${OCR_DIGIT_TOKEN})\s*(?:m|metros)\s*at[ée]\s+(?:o\s+)?(?:v[ée]rtice|ponto|marco|estaca)\s+([A-Z0-9][\w\-.]{1,20})\s*,?\s*(?:\(\s*Longitude\s*:?\s*(${COORD_DMS})${SEP}Latitude\s*:?\s*(${COORD_DMS})(?:${SEP}Altitude\s*:?\s*(-?[\d.,]+))?)?`,
  "gi",
);

/** Restaura o símbolo de grau quando o OCR o converteu em dígito/letra. */
function corrigirGrauOcr(raw: string): { texto: string; corrigido: string | null } {
  if (/[°º]/.test(raw)) return { texto: raw, corrigido: null };
  const texto = raw.replace(/^(\s*\d{1,3}\s*)[oO0q9*]/, "$1°");
  return texto === raw ? { texto, corrigido: null } : { texto, corrigido: `${raw.trim()} → ${texto.trim()}` };
}

const PROSE_START_RE = new RegExp(
  String.raw`(?:v[ée]rtice|ponto|marco|estaca)\s+([A-Z0-9][\w\-.]{1,20})\s*,?\s*(?:de\s+coordenadas\s*)?\(\s*Longitude\s*:?\s*(${COORD_DMS})${SEP}Latitude\s*:?\s*(${COORD_DMS})(?:${SEP}Altitude\s*:?\s*(-?[\d.,]+))?`,
  "i",
);
const PROSE_CONFRONT_RE = /confront(?:ando|a|ante|antes|ação)?\s*(?:-se)?\s*(?:com|:)\s*([^:;]{2,140}?)(?:,\s*com\s+os\s+seguintes|;|\.|:)/gi;

/** Repara apenas a grafia do azimute quando o contexto do caminhamento é inequívoco.
 * Valores de distância sem separador não são reconstruídos por adivinhação. */
function repairProseBearings(text: string): { text: string; repairs: string[] } {
  const repairs: string[] = [];
  const measure = String.raw`\s+e\s+[\dOoDIlZzASsGTBbgq.,/]+\s*(?:m|metros)\s+at[ée]\s+`;
  const record = (before: string, after: string) => {
    if (before !== after) repairs.push(`${before} → ${after}`);
    return after;
  };
  let result = text.replace(new RegExp(String.raw`\b(\d{1,3})\s*([°º])\s*[%/]?\s*(\d{2})(?!\d)(${measure})`, "gi"),
    (match, degree: string, symbol: string, minute: string, rest: string) =>
      record(match, `${degree}${symbol}${minute}'${rest}`));
  result = result.replace(/\b(\d{1,3}[°º])\s*[%/]\s*(\d{2}')/gi,
    (match, degree: string, minute: string) => record(match, `${degree}${minute}`));
  result = result.replace(new RegExp(String.raw`\b(\d{3})(\d{2})(${measure})`, "gi"),
    (match, degree: string, minute: string, rest: string) =>
      Number(degree) <= 359 && Number(minute) < 60
        ? record(match, `${degree}°${minute}'${rest}`) : match);
  result = result.replace(/\b(\d{1,3}),\s*\/\s*(\d{1,3})\s*(?=m\s+at[ée])/gi,
    (match, whole: string, fraction: string) => record(match, `${whole},${fraction} `));
  return { text: result, repairs };
}

/** Caminhamento com destino depois da confrontação: "... até atingir o ponto 2". */
const ARRIVAL_SEG_RE = new RegExp(
  String.raw`azimute\s*(?:de|:)?\s*(\d{1,3}\s*[°º]\s*\d{1,2}\s*[${APOS}]\s*\d{1,2}(?:[.,]\d+)?\s*(?:[${SEC}]|[${APOS}]{1,2})?)\s*(?:,|e)?\s*dist[âa]ncia\s*(?:de|:)?\s*(${OCR_DIGIT_TOKEN})\s*(?:m|metros)\b([^;]{0,240}?)\bat[ée]\s+atingir\s+(?:o\s+)?(?:v[ée]rtice|ponto|marco|estaca)\s+([A-Z0-9][\w\-.]{0,20})\b`,
  "gi",
);

function parseArrivalSegments(flat: string): StructuredParse | null {
  const matches = [...flat.matchAll(ARRIVAL_SEG_RE)];
  if (!matches.length) return null;
  const first = matches[0]!;
  const initial = /(?:v[ée]rtice|ponto|marco|estaca)\s+([A-Z0-9][\w\-.]{0,20})\b/gi;
  const initialMention = [...flat.slice(0, first.index).matchAll(initial)].at(-1);
  if (!initialMention) return null;

  const coords = new Map<string, VertexCoord>();
  const register = (name: string, context: string) => {
    const found = extractCoords(context);
    const key = name.toUpperCase();
    coords.set(key, {
      name: key, lat: found.lat, lon: found.lon,
      north: found.north, east: found.east, alt: null,
    });
  };
  register(initialMention[1]!, flat.slice((initialMention.index ?? 0) + initialMention[0].length, first.index));

  const segments: ParsedSegment[] = [];
  const fixes: string[] = [];
  let from = initialMention[1]!;
  matches.forEach((match, index) => {
    const to = match[4]!;
    const next = matches[index + 1];
    // Coordinates of the arrival vertex follow its name, before the next leg.
    const after = flat.slice((match.index ?? 0) + match[0].length, next?.index ?? flat.length).split(";")[0]!;
    register(to, after);
    const distance = parseNumberOcr(match[2]!);
    if (distance.corrigido) fixes.push(distance.corrigido);
    const confront = /confront(?:ando|a|ante|antes|ação)?\s*(?:-se)?\s*(?:com|:)\s*([\s\S]*?)(?:,?\s*)$/i.exec(match[3]!);
    const azimuth = parseAzimuthText(match[1]!);
    segments.push({
      seq: segments.length + 1, from_vertex: from, to_vertex: to,
      bearing_text: match[1]!.trim(), azimuth_deg: azimuth === null ? null : normalizeAzimuth(azimuth),
      distance_m: distance.value, altitude_from_m: null, altitude_to_m: null,
      confrontante: confront ? cleanConfrontante(confront[1]!) : null,
      raw_text: match[0]!.slice(0, 600),
    });
    from = to;
  });
  return { segments, coords, ...(fixes.length ? { warnings: [avisoOcr(fixes)] } : {}) };
}

function parseProseSegments(flat: string): StructuredParse | null {
  const repaired = repairProseBearings(flat);
  flat = repaired.text;
  const start = PROSE_START_RE.exec(flat);
  if (!start) return null;

  const confrontos: { pos: number; nome: string | null }[] = [];
  PROSE_CONFRONT_RE.lastIndex = 0;
  for (const c of flat.matchAll(PROSE_CONFRONT_RE)) {
    confrontos.push({ pos: c.index ?? 0, nome: cleanConfrontante(c[1]!) });
  }
  const confrontanteEm = (pos: number): string | null => {
    let atual: string | null = null;
    for (const c of confrontos) {
      if (c.pos <= pos) atual = c.nome;
      else break;
    }
    return atual;
  };

  const coords = new Map<string, VertexCoord>();
  const registrar = (
    name: string,
    lonRaw: string,
    latRaw: string,
    altRaw: string | undefined,
  ): number | null => {
    const key = name.toUpperCase();
    const alt = altRaw ? parseNumber(altRaw) : null;
    coords.set(key, {
      name: key,
      lon: parseGeoCoord(lonRaw),
      lat: parseGeoCoord(latRaw),
      alt,
      north: null,
      east: null,
    });
    return alt;
  };

  let prevName = start[1]!;
  let prevAlt = registrar(prevName, start[2]!, start[3]!, start[4]);

  const segments: ParsedSegment[] = [];
  const ocrFixes: string[] = [];
  const dubious: string[] = [];
  PROSE_SEG_RE.lastIndex = 0;
  for (const m of flat.matchAll(PROSE_SEG_RE)) {
    const [, azRawBruto, distRaw, to, lonRaw, latRaw, altRaw] = m;
    const grau = corrigirGrauOcr(azRawBruto!);
    if (grau.corrigido) ocrFixes.push(grau.corrigido);
    const azRaw = grau.texto;
    const alt =
      lonRaw && latRaw
        ? registrar(to!, lonRaw, latRaw, altRaw)
        : (coords.get(to!.toUpperCase())?.alt ?? null);
    const az = parseAzimuthText(azRaw);
    const dist = parseNumberOcr(distRaw!);
    if (dist.corrigido) ocrFixes.push(dist.corrigido);
    const previousCoord = coords.get(prevName.toUpperCase());
    const nextCoord = coords.get(to!.toUpperCase());
    const geometric = previousCoord && nextCoord ? geometryBetween(previousCoord, nextCoord).distance : null;
    // A medida geodésica calculada é apenas uma checagem de plausibilidade,
    // não substitui a distância declarada no documento.
    const distanceValid = dist.value !== null && dist.value > 0 &&
      (geometric === null || Math.abs(dist.value - geometric) <= Math.max(2, geometric * 0.08));
    if (!distanceValid) dubious.push(`${prevName} → ${to}: distância ${distRaw} m incompatível ou ilegível${geometric !== null ? ` (coordenadas indicam cerca de ${geometric.toFixed(1)} m)` : ""}; conferir no PDF.`);
    segments.push({
      seq: segments.length + 1,
      from_vertex: prevName,
      to_vertex: to!,
      bearing_text: azRaw.trim(),
      azimuth_deg: az === null ? null : normalizeAzimuth(az),

      distance_m: distanceValid ? dist.value : null,
      altitude_from_m: prevAlt,
      altitude_to_m: alt,
      confrontante: confrontanteEm(m.index ?? 0),
      raw_text: m[0]!.slice(0, 600),
    });
    prevName = to!;
    prevAlt = alt;
  }

  // Um destino escrito no memorial mas não interpretado não pode ser pulado:
  // a sequência posterior pareceria válida embora esteja faltando um trecho.
  const destinations = [...flat.matchAll(/\bat[ée]\s+(?:o\s+)?v[ée]rtice\s+([A-Z0-9][\w\-.]{1,20})\b/gi)]
    .map((m) => m[1]!.toUpperCase());
  const parsedDestinations = segments.map((s) => s.to_vertex?.toUpperCase());
  if (destinations.length > parsedDestinations.length) {
    const parsed = new Set(parsedDestinations);
    const missing = destinations.filter((name) => !parsed.has(name));
    dubious.push(`Sequência incompleta: ${destinations.length} destinos no texto, ${parsedDestinations.length} trechos lidos${missing.length ? `; conferir ${[...new Set(missing)].slice(0, 8).join(", ")}` : ""}.`);
  }
  return segments.length >= 3
    ? { segments, coords, warnings: [
        ...(repaired.repairs.length ? [`Pontuação de medidas restaurada no texto (${repaired.repairs.length}); conferir os azimutes e distâncias no PDF.`] : []),
        ...(ocrFixes.length ? [avisoOcr(ocrFixes)] : []),
        ...dubious,
      ] }
    : null;
}

export function parseMemorial(text: string): ParsedParcel {
  const warnings: string[] = [];
  const { text: normalizado, aplicadas } = normalizeMemorialText(text);
  if (aplicadas.length > 0) {
    warnings.push(
      `Padronização léxica aplicada antes da extração (${aplicadas.length}): ${aplicadas.join("; ")}.`,
    );
  }
  const flat = repairLineBreaks(normalizado);

  const area = extractArea(flat, normalizado);
  if (area === null) warnings.push("Área não localizada no texto.");

  const declaredPerimeter = extractPerimeter(flat, normalizado);
  if (declaredPerimeter === null) warnings.push("Perímetro declarado não localizado.");

  const matricula = MATRICULA_RE.exec(flat);

  const tableParse = parseMeasureTable(normalizado);
  const structured =
    parseSigefTable(normalizado) ?? parseArrivalSegments(flat) ?? parseProseSegments(flat) ?? tableParse;

  if (structured?.warnings?.length) warnings.push(...structured.warnings);

  const segments: ParsedSegment[] = structured?.segments ?? [];
  const coordMap = structured?.coords ?? new Map<string, VertexCoord>();
  const chunks = structured ? [] : splitSegments(flat);

  // Complementa grandezas ausentes com o que estiver em tabela anexa
  // (ex.: memorial em prosa acompanhado de tabela de coordenadas/altitudes).
  if (tableParse && structured && structured !== tableParse) {
    tableParse.coords.forEach((v, key) => {
      const prev = coordMap.get(key);
      // Uma tabela complementar só pode enriquecer vértices já reconhecidos
      // pelo parser principal. Isso evita transformar números da prosa
      // (distância, azimute etc.) em vértices/cotas espúrios.
      if (!prev) return;
      coordMap.set(key, {
        name: key,
        lon: prev.lon ?? v.lon,
        lat: prev.lat ?? v.lat,
        alt: prev.alt ?? v.alt,
        north: prev.north ?? v.north,
        east: prev.east ?? v.east,
      });
    });
    segments.forEach((s) => {
      if (s.altitude_from_m === null && s.from_vertex)
        s.altitude_from_m = coordMap.get(s.from_vertex.toUpperCase())?.alt ?? null;
      if (s.altitude_to_m === null && s.to_vertex)
        s.altitude_to_m = coordMap.get(s.to_vertex.toUpperCase())?.alt ?? null;
      if (s.azimuth_deg === null || s.distance_m === null) {
        const a = s.from_vertex ? coordMap.get(s.from_vertex.toUpperCase()) : undefined;
        const b = s.to_vertex ? coordMap.get(s.to_vertex.toUpperCase()) : undefined;
        if (a && b) {
          const g = geometryBetween(a, b);
          if (s.azimuth_deg === null) s.azimuth_deg = g.azimuth;
          // Nunca substituir por distância calculada uma medida que consta no
          // documento mas cuja camada de texto está ilegível/incompatível.
          if (s.distance_m === null && !/\b[\dOoDIlZzASsGTBbgq.,/]+\s*m\s+at[ée]\b/i.test(s.raw_text)) s.distance_m = g.distance;
        }
      }
    });
  }





  chunks.forEach((chunk) => {
    const pair = VERTEX_PAIR_RE.exec(chunk);
    let from: string | null = null;
    let to: string | null = null;
    if (pair) {
      from = pair[1]!;
      to = pair[2]!;
    } else {
      const single = VERTEX_SINGLE_RE.exec(chunk);
      if (single) from = single[1]!;
    }

    let distance: number | null = null;
    const dm = DIST_RE.exec(chunk);
    if (dm) {
      const v = parseNumber(dm[1]!);
      distance = v === null ? null : dm[2]!.toLowerCase() === "km" ? v * 1000 : v;
    } else {
      const fb = DIST_FALLBACK_RE.exec(chunk);
      if (fb) distance = parseNumber(fb[1]!);
    }

    let azimuth: number | null = null;
    let bearingText: string | null = null;
    const rumo = RUMO_RE.exec(chunk);
    if (rumo) {
      bearingText = `${rumo[1]!.trim()} ${rumo[2]!}`;
      const angle = parseAzimuthText(rumo[1]!);
      if (angle !== null) azimuth = bearingToAzimuth(angle, rumo[2]!);
    } else {
      const az = AZ_RE.exec(chunk);
      if (az) {
        bearingText = az[1]!.trim();
        azimuth = parseAzimuthText(az[1]!);
      }
    }
    if (azimuth !== null) azimuth = normalizeAzimuth(azimuth);

    ALT_RE.lastIndex = 0;
    const altitudes: { valor: number; pos: number }[] = [];
    for (const m of chunk.matchAll(ALT_RE)) {
      const v = parseNumber(m[1]!);
      if (v !== null && Math.abs(v) < 9000)
        altitudes.push({ valor: v, pos: m.index ?? 0 });
    }
    // Uma única cota depois do conector "até" pertence ao vértice de chegada.
    const ateIdx = /(?:^|\s)at[ée](?=\s)/i.exec(chunk)?.index ?? -1;
    let altitudeFrom: number | null = null;
    let altitudeTo: number | null = null;
    if (altitudes.length === 1) {
      const only = altitudes[0]!;
      if (ateIdx >= 0 && only.pos > ateIdx) altitudeTo = only.valor;
      else altitudeFrom = only.valor;
    } else if (altitudes.length > 1) {
      altitudeFrom = altitudes[0]!.valor;
      altitudeTo = altitudes[altitudes.length - 1]!.valor;
    }

    const conf = CONFRONT_RE.exec(chunk);
    const confrontante = conf ? cleanConfrontante(conf[1]!) : null;

    if (from === null && distance === null && azimuth === null) return;

    const coords = extractCoords(chunk);
    if (
      from &&
      (coords.lat !== null ||
        coords.lon !== null ||
        coords.north !== null ||
        coords.east !== null)
    ) {
      const key = from.toUpperCase();
      const prev = coordMap.get(key);
      coordMap.set(key, {
        name: key,
        lat: coords.lat ?? prev?.lat ?? null,
        lon: coords.lon ?? prev?.lon ?? null,
        north: coords.north ?? prev?.north ?? null,
        east: coords.east ?? prev?.east ?? null,
        alt: altitudeFrom ?? prev?.alt ?? null,
      });
    } else if (from && altitudeFrom !== null && !coordMap.has(from.toUpperCase())) {
      coordMap.set(from.toUpperCase(), {
        name: from.toUpperCase(),
        lat: null,
        lon: null,
        north: null,
        east: null,
        alt: altitudeFrom,
      });
    }

    segments.push({
      seq: segments.length + 1,
      from_vertex: from,
      to_vertex: to,
      bearing_text: bearingText,
      azimuth_deg: azimuth,
      distance_m: distance,
      altitude_from_m: altitudeFrom,
      altitude_to_m: altitudeTo,
      confrontante,
      raw_text: chunk.slice(0, 600),
    });
  });

  // A altitude é atributo do vértice, não do segmento. Consolida uma única
  // cota por código e replica esse mesmo valor nas referências de entrada e
  // saída, impedindo que um vértice receba duas altitudes distintas.
  const altitudeByVertex = new Map<string, number>();
  coordMap.forEach((coord, key) => {
    if (coord.alt !== null) altitudeByVertex.set(key.toUpperCase(), coord.alt);
  });
  for (const segment of segments) {
    if (segment.from_vertex && segment.altitude_from_m !== null) {
      const key = segment.from_vertex.toUpperCase();
      if (!altitudeByVertex.has(key)) altitudeByVertex.set(key, segment.altitude_from_m);
    }
    if (segment.to_vertex && segment.altitude_to_m !== null) {
      const key = segment.to_vertex.toUpperCase();
      if (!altitudeByVertex.has(key)) altitudeByVertex.set(key, segment.altitude_to_m);
    }
  }
  for (const segment of segments) {
    segment.altitude_from_m = segment.from_vertex
      ? (altitudeByVertex.get(segment.from_vertex.toUpperCase()) ?? null)
      : null;
    segment.altitude_to_m = segment.to_vertex
      ? (altitudeByVertex.get(segment.to_vertex.toUpperCase()) ?? null)
      : null;
  }


  if (segments.length === 0) {
    warnings.push(
      "Nenhum segmento (vértice/azimute/distância) foi identificado. Verifique se o texto é um memorial descritivo.",
    );
  }

  // Uma ligação contínua entre trechos não prova que a transcrição não saltou
  // um vértice. Só sinalizar saltos quando os códigos compartilham prefixo e
  // numeração consecutiva; nunca criar um trecho a partir de um número ausente.
  for (const segment of segments) {
    const from = /^(.*?)(\d+)$/.exec(segment.from_vertex ?? "");
    const to = /^(.*?)(\d+)$/.exec(segment.to_vertex ?? "");
    if (from && to && from[1] === to[1] && Number(to[2]) - Number(from[2]) > 1) {
      warnings.push(`Possível salto de vértices ${segment.from_vertex} → ${segment.to_vertex}; conferir trechos intermediários no PDF.`);
    }
  }

  const missingMeasures = segments.filter((s) => s.distance_m === null).length;
  if (missingMeasures) warnings.push(`${missingMeasures} trecho(s) com distância não confirmada; o perímetro calculado não é confiável.`);

  const computedPerimeter = segments.reduce(
    (acc, s) => acc + (s.distance_m ?? 0),
    0,
  );
  if (!missingMeasures && declaredPerimeter !== null && segments.length > 0 &&
    Math.abs(computedPerimeter - declaredPerimeter) > Math.max(2, declaredPerimeter * 0.01)) {
    warnings.push(`Perímetro dos trechos (${computedPerimeter.toFixed(2)} m) diverge do declarado (${declaredPerimeter.toFixed(2)} m); conferir a sequência e as medidas.`);
  }

  const vertices = new Set<string>();
  segments.forEach((s) => {
    if (s.from_vertex) vertices.add(s.from_vertex.toUpperCase());
    if (s.to_vertex) vertices.add(s.to_vertex.toUpperCase());
  });

  const confrontantes: string[] = [];
  const seen = new Set<string>();
  segments.forEach((s) => {
    if (!s.confrontante) return;
    const key = normalizeName(s.confrontante);
    if (key && !seen.has(key)) {
      seen.add(key);
      confrontantes.push(s.confrontante);
    }
  });

  // Altimetria: cada vértice participa uma única vez das estatísticas.
  const altitudes = [...altitudeByVertex.values()];
  const altitudeMin = altitudes.length > 0 ? Math.min(...altitudes) : null;
  const altitudeMax = altitudes.length > 0 ? Math.max(...altitudes) : null;
  const altitudeMean =
    altitudes.length > 0
      ? Number((altitudes.reduce((a, v) => a + v, 0) / altitudes.length).toFixed(3))
      : null;
  if (segments.length > 0 && altitudes.length === 0) {
    warnings.push(
      "Nenhuma altitude (cota) foi identificada nos vértices; a comparação altimétrica ficará inconclusiva.",
    );
  }

  const missingAz = segments.filter((s) => s.azimuth_deg === null).length;
  if (segments.length > 0 && missingAz > 0) {
    warnings.push(
      `${missingAz} de ${segments.length} segmentos sem azimute/rumo identificado.`,
    );
  }

  return {
    label: matricula ? `Matrícula ${matricula[1]}` : null,
    area_m2: area,
    declared_perimeter_m: declaredPerimeter,
    computed_perimeter_m: computedPerimeter > 0 && !missingMeasures ? computedPerimeter : null,
    vertex_count: vertices.size,
    altitude_min_m: altitudeMin,
    altitude_max_m: altitudeMax,
    altitude_mean_m: altitudeMean,
    confrontantes,
    segments,
    vertices: [...coordMap.values()],
    warnings,

  };
}
