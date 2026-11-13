import clipping, { type MultiPolygon, type Ring } from "polygon-clipping";
import kinks from "@turf/kinks";
import proj4 from "proj4";
import { percurso } from "./export-geometria";
import type { ParcelExport } from "./export-registral";
import type { ComparisonResult, Finding, Tolerances } from "./comparison-engine";

export type OverlayVertex = { name: string; x: number; y: number; north: number | null; east: number | null; lat: number | null; lon: number | null; lat_raw?: string | null; lon_raw?: string | null; newVertex: boolean; external: boolean; matched: boolean };
export type OverlayMetrics = {
  mode: "overlay"; reference: string; labels: string[]; polygons: OverlayVertex[][];
  totalAreaM2: number; parcelAreasM2: number[]; gapM2: number; overlapM2: number; outsideM2: number;
  boundaryDeviationM: number; missingTotalVertices: string[];
};
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const dist = (a: OverlayVertex, b: OverlayVertex) => Math.hypot(a.x - b.x, a.y - b.y);
function segmentDistance(p: { x: number; y: number }, a: number[], b: number[]) {
  const dx = (b[0] ?? 0) - (a[0] ?? 0), dy = (b[1] ?? 0) - (a[1] ?? 0);
  const t = Math.max(0, Math.min(1, ((p.x - (a[0] ?? 0)) * dx + (p.y - (a[1] ?? 0)) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - ((a[0] ?? 0) + t * dx), p.y - ((a[1] ?? 0) + t * dy));
}
const boundaryDistance = (p: { x: number; y: number }, rings: Ring[]) => Math.min(...rings.flatMap(r => r.slice(1).map((b, i) => segmentDistance(p, r[i] ?? b, b))));
function area(shape: MultiPolygon): number {
  const ringArea = (r: Ring) => Math.abs(r.reduce((sum, p, i) => {
    const q = r[(i + 1) % r.length];
    return sum + (p[0] ?? 0) * (q?.[1] ?? 0) - (q?.[0] ?? 0) * (p[1] ?? 0);
  }, 0)) / 2;
  return shape.reduce((sum, p) => sum + ringArea(p[0] ?? []) - p.slice(1).reduce((s, r) => s + ringArea(r), 0), 0);
}

/** One common metric frame; no fabricated coordinates or automatic ring closure. */
export function compareOverlay(parcels: ParcelExport[], labels: string[], tol: Tolerances, planarReferenceConfirmed = false): ComparisonResult {
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, title: string, description: string, evidence: Record<string, unknown> = {}) => findings.push({ severity, code, title, description, evidence });
  try {
    if (parcels.length !== 3) throw new Error("Selecione uma área total e exatamente duas glebas distintas.");
    const paths = parcels.map(percurso);
    if (paths.some(p => !p.closed || p.points.length < 3)) throw new Error("Todos os caminhamentos precisam estar completos e fechados.");
    const all = paths.flatMap(p => p.points);
    const geographic = all.every(p => finite(p.lon) && finite(p.lat) && Math.abs(p.lon) <= 180 && Math.abs(p.lat) <= 90);
    if (!geographic && (!planarReferenceConfirmed || !all.every(p => finite(p.east) && finite(p.north)))) throw new Error("Faltam coordenadas geográficas completas; para E/N, confirme que os três polígonos usam o mesmo sistema de referência.");
    const first = all[0];
    if (!first) throw new Error("Coordenadas ausentes.");
    const zone = Math.max(1, Math.min(60, Math.floor(((first.lon ?? 0) + 180) / 6) + 1));
    const target = `+proj=utm +zone=${zone} ${(first.lat ?? 0) < 0 ? "+south " : ""}+datum=WGS84 +units=m +no_defs`;
    const reference = geographic ? `WGS84 / UTM ${zone}${(first.lat ?? 0) < 0 ? "S" : "N"}` : "E/N — referência comum confirmada pelo conferente";
    let polygons: OverlayVertex[][] = paths.map((p, index) => p.points.map(v => {
      const xy = geographic ? proj4("WGS84", target, [v.lon as number, v.lat as number]) : [v.east as number, v.north as number];
      if (!finite(xy[0]) || !finite(xy[1])) throw new Error("Coordenadas não puderam ser convertidas.");
      const raw = parcels[index]?.raw_extraction as { vertices?: { name: string; lat_raw?: string | null; lon_raw?: string | null }[] } | undefined;
      const source = raw?.vertices?.find(r => r.name.trim().toUpperCase() === v.name);
      return { name: v.name, x: xy[0], y: xy[1], north: v.north, east: v.east, lat: v.lat, lon: v.lon, lat_raw: source?.lat_raw ?? null, lon_raw: source?.lon_raw ?? null, newVertex: false, external: false, matched: false };
    }));
    // Translate before clipping/shoelace to avoid cancellation with large UTM ordinates.
    const origin = polygons[0]?.[0];
    if (!origin) throw new Error("Área total sem vértices.");
    const ox = origin.x, oy = origin.y;
    polygons = polygons.map(p => p.map(v => ({ ...v, x: v.x - ox, y: v.y - oy })));
    const rings: Ring[] = polygons.map(p => {
      const r = p.map(v => [v.x, v.y] as [number, number]);
      const start = r[0];
      if (!start) throw new Error("Polígono vazio.");
      r.push(start);
      if (kinks({ type: "Polygon", coordinates: [r] }).features.length) throw new Error("Polígono com cruzamento do próprio perímetro; revise os vértices.");
      if (area([[r]]) <= 1e-6) throw new Error("Polígono sem área válida.");
      return r;
    });
    const [total, b, c] = rings;
    if (!total || !b || !c) throw new Error("Polígonos insuficientes.");
    const union = clipping.union([b], [c]);
    const gapM2 = area(clipping.difference([total], union));
    const overlapM2 = area(clipping.intersection([b], [c]));
    const outsideM2 = area(clipping.difference(union, [total]));
    const totalAreaM2 = area([[total]]);
    const areaLimit = Math.max(1e-6, tol.areaM2, totalAreaM2 * tol.areaPct / 100);
    const distanceLimit = Math.max(1e-7, tol.distanceM);
    const unionRings = union.flatMap(p => p);
    // Directed endpoints plus midpoints catch missing bends and displaced external edges.
    const samples = (rs: Ring[]) => rs.flatMap(r => r.slice(1).flatMap((v, i) => { const a = r[i] ?? v; return [{ x: v[0] ?? 0, y: v[1] ?? 0 }, { x: ((a[0] ?? 0) + (v[0] ?? 0)) / 2, y: ((a[1] ?? 0) + (v[1] ?? 0)) / 2 }]; }));
    const boundaryDeviationM = Math.max(...samples([total]).map(v => boundaryDistance(v, unionRings)), ...samples(unionRings).map(v => boundaryDistance(v, [total])));
    const totalVertices = polygons[0] ?? [];
    const parcelVertices = polygons.slice(1).flat();
    for (const v of parcelVertices) {
      v.external = boundaryDistance(v, union.map(p => p[0] ?? [])) <= distanceLimit;
      v.newVertex = !totalVertices.some(t => dist(v, t) <= distanceLimit);
      v.matched = !v.newVertex;
    }
    const missingTotalVertices = totalVertices.filter(t => !parcelVertices.some(v => v.external && dist(t, v) <= distanceLimit)).map(t => t.name);
    for (const t of totalVertices) { t.external = true; t.matched = !missingTotalVertices.includes(t.name); }
    for (const [value, code, title] of [[gapM2, "OVERLAY_GAP", "Área total não coberta"], [overlapM2, "OVERLAY_OVERLAP", "Sobreposição entre glebas"], [outsideM2, "OVERLAY_OUTSIDE", "Glebas fora da área total"]] as const) {
      if (value > areaLimit) add("critical", code, title, `${value.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} m²; tolerância de área: ${areaLimit} m².`, { area_m2: value });
    }
    if (boundaryDeviationM > distanceLimit) add("critical", "OVERLAY_BOUNDARY", "Contorno externo divergente", `Afastamento do contorno: ${boundaryDeviationM.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} m.`, { deviation_m: boundaryDeviationM });
    if (missingTotalVertices.length) add("moderate", "OVERLAY_MISSING_VERTICES", "Vértices originais sem correspondência externa", missingTotalVertices.join(", "), { vertices: missingTotalVertices });
    const newVertices = parcelVertices.filter(v => v.newVertex);
    if (newVertices.length) add("informative", "OVERLAY_NEW_VERTICES", "Novos vértices do desmembramento", newVertices.map(v => `${v.name} (${v.external ? "externo" : "interno"})`).join(", "), { vertices: newVertices });
    const classification = findings.some(f => f.severity === "critical") ? "incompatible" : missingTotalVertices.length ? "compatible_with_remarks" : "compatible";
    const overlay: OverlayMetrics = { mode: "overlay", reference, labels, polygons, totalAreaM2, parcelAreasM2: [area([[b]]), area([[c]])], gapM2, overlapM2, outsideM2, boundaryDeviationM, missingTotalVertices };
    return { classification, summary: classification === "incompatible" ? "As duas glebas não recompõem a área total dentro das tolerâncias adotadas." : classification === "compatible_with_remarks" ? "As glebas recompõem a área total, mas há vértices originais sem correspondência externa." : "As duas glebas recompõem a área total dentro das tolerâncias adotadas, com os vértices originais preservados.", metrics: { overlay, counts: Object.fromEntries(["critical", "moderate", "informative", "inconclusive"].map(s => [s, findings.filter(f => f.severity === s).length])) }, findings };
  } catch (error) {
    add("inconclusive", "OVERLAY_INVALID_GEOMETRY", "Sobreposição não verificável", error instanceof Error ? error.message : "Geometria inválida.");
    return { classification: "inconclusive", summary: findings[0]?.description ?? "Geometria inválida.", metrics: { counts: { inconclusive: 1 } }, findings };
  }
}

export function readOverlay(metrics: Record<string, unknown>): OverlayMetrics | undefined {
  const o = metrics["overlay"] as OverlayMetrics | undefined;
  return o?.mode === "overlay" && Array.isArray(o.polygons) ? o : undefined;
}