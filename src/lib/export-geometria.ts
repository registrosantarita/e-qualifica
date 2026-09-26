import { zipSync, strToU8 } from "fflate";
import type { ParcelExport, VertexCoordRow } from "./export-registral";

type Ponto = { name: string; lon: number | null; lat: number | null; alt: number | null; north: number | null; east: number | null };
type Trajeto = { points: Ponto[]; closed: boolean };

const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const key = (value: string | null) => (value ?? "").trim().replace(/[.,;]+$/, "").toUpperCase();
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Respeita a ordem dos segmentos; não inventa vértices nem fecha um perímetro aberto. */
export function percurso(parcel: ParcelExport): Trajeto {
  const raw = parcel.raw_extraction as { vertices?: VertexCoordRow[] } | null;
  const vertices = new Map((Array.isArray(raw?.vertices) ? raw.vertices : []).map((v) => [key(String(v.name)), v]));
  const segments = [...parcel.segments].sort((a, b) => a.seq - b.seq);
  if (!segments.length) throw new Error("A descrição não contém trechos para exportar.");
  const names = [key(segments[0]?.from_vertex ?? null)];
  for (const s of segments) {
    if (key(s.from_vertex) !== names[names.length - 1]) throw new Error("Os trechos não formam um caminho contínuo; revise os vértices antes de exportar.");
    names.push(key(s.to_vertex));
  }
  if (names.some((name) => !name)) throw new Error("Faltam nomes de vértices em alguns trechos.");
  const closed = names.length >= 4 && names[0] === names[names.length - 1];
  const uniqueNames = closed ? names.slice(0, -1) : names;
  const points = uniqueNames.map((name) => {
    const v = vertices.get(name);
    if (!v) throw new Error(`Coordenadas do vértice ${name} não encontradas. Não é possível exportar só azimutes e distâncias sem uma origem.`);
    return { name, lon: v.lon, lat: v.lat, alt: v.alt, north: v.north, east: v.east };
  });
  if (points.length < 2) throw new Error("São necessários ao menos dois vértices com coordenadas.");
  return { points, closed };
}

export function montarKml(parcel: ParcelExport): string {
  const { points, closed } = percurso(parcel);
  for (const p of points) {
    if (!valid(p.lon) || !valid(p.lat) || Math.abs(p.lon) > 180 || Math.abs(p.lat) > 90) {
      throw new Error("KML/KMZ exige longitude e latitude válidas para todos os vértices; coordenadas planas sem referência geográfica não podem ser convertidas automaticamente.");
    }
  }
  const coords = [...points, ...(closed ? [points[0]] : [])].map((p) => `${p?.lon},${p?.lat}${valid(p?.alt) ? `,${p.alt}` : ""}`).join(" ");
  const name = xml(parcel.label?.trim() || "Descrição perimétrica");
  const geometry = closed
    ? `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
    : `<LineString><coordinates>${coords}</coordinates></LineString>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${name}</name><Placemark><name>${name}</name>${geometry}</Placemark></Document></kml>`;
}

export function montarKmz(parcel: ParcelExport): Uint8Array {
  return zipSync({ "doc.kml": strToU8(montarKml(parcel)) });
}

/** DWG usa metros: preserva E/N quando presentes ou projeta WGS84 em UTM local. */
export async function montarDwg(parcel: ParcelExport): Promise<{ bytes: Uint8Array; reference: string }> {
  const { points, closed } = percurso(parcel);
  const planar = points.every((p) => valid(p.east) && valid(p.north));
  const geographic = points.every((p) => valid(p.lon) && valid(p.lat) && Math.abs(p.lon) <= 180 && Math.abs(p.lat) <= 90);
  if (!planar && !geographic) throw new Error("DWG exige coordenadas planas E/N ou longitude/latitude válidas em todos os vértices.");

  let reference = "Coordenadas E/N originais (sistema de referência não informado)";
  let coords: { x: number; y: number; z: number }[];
  if (planar) {
    coords = points.map((p) => ({ x: p.east as number, y: p.north as number, z: valid(p.alt) ? p.alt : 0 }));
  } else {
    const first = points[0];
    const zone = Math.min(60, Math.max(1, Math.floor(((first?.lon as number) + 180) / 6) + 1));
    const south = (first?.lat as number) < 0;
    const proj4 = (await import("proj4")).default;
    const target = `+proj=utm +zone=${zone} ${south ? "+south " : ""}+datum=WGS84 +units=m +no_defs`;
    coords = points.map((p) => {
      const [x, y] = proj4("WGS84", target, [p.lon as number, p.lat as number]);
      if (!valid(x) || !valid(y)) throw new Error("Não foi possível projetar os vértices para UTM.");
      return { x, y, z: valid(p.alt) ? p.alt : 0 };
    });
    reference = `WGS84 / UTM zona ${zone}${south ? "S" : "N"} (projeção para exportação CAD)`;
  }

  const { CadDocument, DwgWriter, ACadVersion, Line, XYZ } = await import("@node-projects/acad-ts");
  const doc = new CadDocument();
  doc.header.version = ACadVersion.AC1027;
  for (let i = 0; i < coords.length - (closed ? 0 : 1); i++) {
    const a = coords[i];
    const b = coords[(i + 1) % coords.length];
    if (a && b) doc.modelSpace.addEntity(new Line(new XYZ(a.x, a.y, a.z), new XYZ(b.x, b.y, b.z)));
  }
  const bytes = DwgWriter.writeToBuffer(doc);
  if (bytes.length < 100 || new TextDecoder().decode(bytes.slice(0, 2)) !== "AC") throw new Error("O arquivo DWG gerado não passou na validação.");
  return { bytes, reference };
}

export function baixarGeometria(data: string | Uint8Array, fileName: string, mime: string) {
  const blob = new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}