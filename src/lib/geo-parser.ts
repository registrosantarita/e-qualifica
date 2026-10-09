/**
 * Leitura de geometrias vetoriais (KML e GeoJSON) e conversão para a mesma
 * estrutura normalizada dos memoriais descritivos, permitindo a comparação
 * memorial x perímetro georreferenciado.
 */

import type { ParsedParcel, ParsedSegment } from "./memorial-parser";

export type LonLat = { lon: number; lat: number; alt: number | null };

const R = 6378137; // raio equatorial WGS-84, em metros
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineMeters(a: LonLat, b: LonLat): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function forwardAzimuth(a: LonLat, b: LonLat): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Área do polígono por projeção equirretangular local (adequada a lotes). */
export function polygonAreaM2(ring: LonLat[]): number {
  if (ring.length < 3) return 0;
  const lat0 = rad(ring.reduce((s, p) => s + p.lat, 0) / ring.length);
  const pts = ring.map((p) => ({
    x: R * rad(p.lon) * Math.cos(lat0),
    y: R * rad(p.lat),
  }));
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    acc += p.x * q.y - q.x * p.y;
  }
  return Math.abs(acc / 2);
}

function normalizeRing(coords: LonLat[]): LonLat[] {
  const ring = [...coords];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    ring.length > 1 &&
    first &&
    last &&
    Math.abs(first.lon - last.lon) < 1e-12 &&
    Math.abs(first.lat - last.lat) < 1e-12
  ) {
    ring.pop();
  }
  return ring;
}

function vertexName(i: number): string {
  return `V${i + 1}`;
}

function buildParcel(
  label: string | null,
  coords: LonLat[],
  warnings: string[],
): ParsedParcel {
  const ring = normalizeRing(coords);
  const segments: ParsedSegment[] = [];
  let perimeter = 0;

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const distance = haversineMeters(a, b);
    const azimuth = forwardAzimuth(a, b);
    perimeter += distance;
    segments.push({
      seq: i + 1,
      from_vertex: vertexName(i),
      to_vertex: vertexName((i + 1) % ring.length),
      bearing_text: `${azimuth.toFixed(4)}°`,
      azimuth_deg: Number(azimuth.toFixed(6)),
      distance_m: Number(distance.toFixed(3)),
      altitude_from_m: a.alt ?? null,
      altitude_to_m: b.alt ?? null,
      confrontante: null,
      raw_text: `${vertexName(i)} → ${vertexName((i + 1) % ring.length)}: ${azimuth.toFixed(4)}° / ${distance.toFixed(3)} m${
        a.alt === null || a.alt === undefined ? "" : ` / altitude ${a.alt.toFixed(2)} m`
      }`,
    });
  }

  if (ring.length < 3) {
    warnings.push("A geometria possui menos de três vértices e não forma polígono.");
  }

  const alts = ring
    .map((p) => (p.alt === null || p.alt === undefined ? null : p.alt))
    .filter((v): v is number => v !== null);
  if (alts.length === 0) {
    warnings.push("A geometria não traz altitude (Z) nos vértices.");
  }

  return {
    label,
    area_m2: ring.length >= 3 ? Number(polygonAreaM2(ring).toFixed(3)) : null,
    declared_perimeter_m: null,
    computed_perimeter_m: Number(perimeter.toFixed(3)),
    vertex_count: ring.length,
    altitude_min_m: alts.length > 0 ? Math.min(...alts) : null,
    altitude_max_m: alts.length > 0 ? Math.max(...alts) : null,
    altitude_mean_m:
      alts.length > 0
        ? Number((alts.reduce((s, v) => s + v, 0) / alts.length).toFixed(3))
        : null,
    confrontantes: [],
    segments,
    vertices: ring.map((p, i) => ({
      name: vertexName(i),
      lon: p.lon,
      lat: p.lat,
      alt: p.alt ?? null,
      north: null,
      east: null,
    })),
    warnings,

  };
}

function parseKmlCoordinates(block: string): LonLat[] {
  return block
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const [lon, lat, alt] = tuple.split(",").map(Number);
      return Number.isFinite(lon) && Number.isFinite(lat)
        ? ({
            lon: lon as number,
            lat: lat as number,
            alt: Number.isFinite(alt) ? (alt as number) : null,
          } satisfies LonLat)
        : null;
    })
    .filter((p): p is LonLat => p !== null);
}

/** Extrai o maior polígono de um KML. */
export function parseKml(xml: string): ParsedParcel | null {
  const warnings: string[] = [];
  const outers = [
    ...xml.matchAll(
      /<outerBoundaryIs[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/outerBoundaryIs>/gi,
    ),
  ].map((m) => m[1]!);
  const blocks =
    outers.length > 0
      ? outers
      : [...xml.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)].map((m) => m[1]!);
  if (blocks.length === 0) return null;

  const rings = blocks.map(parseKmlCoordinates).filter((r) => r.length >= 2);
  if (rings.length === 0) return null;
  if (rings.length > 1) {
    warnings.push(
      `O arquivo contém ${rings.length} geometrias; foi utilizada a de maior área.`,
    );
  }
  const ring = rings.reduce((best, r) =>
    polygonAreaM2(r) > polygonAreaM2(best) ? r : best,
  );

  const nameMatch = /<name>([\s\S]*?)<\/name>/i.exec(xml);
  const label = nameMatch ? nameMatch[1]!.replace(/<[^>]+>/g, "").trim() : null;
  return buildParcel(label || null, ring, warnings);
}

type GeoJsonGeometry = { type?: string; coordinates?: unknown };

function ringsFromGeometry(geom: GeoJsonGeometry): LonLat[][] {
  const toRing = (arr: unknown): LonLat[] =>
    Array.isArray(arr)
      ? arr
          .map((c) =>
            Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])
              ? ({
                  lon: Number(c[0]),
                  lat: Number(c[1]),
                  alt: Number.isFinite(c[2]) ? Number(c[2]) : null,
                } satisfies LonLat)
              : null,
          )
          .filter((p): p is LonLat => p !== null)
      : [];

  if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
    return [toRing(geom.coordinates[0])];
  }
  if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
    return geom.coordinates.map((poly) =>
      toRing(Array.isArray(poly) ? poly[0] : null),
    );
  }
  if (geom.type === "LineString") {
    return [toRing(geom.coordinates)];
  }
  return [];
}

/** Extrai o maior polígono de um GeoJSON (Feature, FeatureCollection ou Geometry). */
export function parseGeoJson(raw: string): ParsedParcel | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const warnings: string[] = [];
  const features: { geometry?: GeoJsonGeometry; properties?: Record<string, unknown> }[] =
    [];
  const obj = json as Record<string, unknown>;
  if (obj["type"] === "FeatureCollection" && Array.isArray(obj["features"])) {
    features.push(...(obj["features"] as typeof features));
  } else if (obj["type"] === "Feature") {
    features.push(obj as (typeof features)[number]);
  } else {
    features.push({ geometry: obj as GeoJsonGeometry });
  }

  let best: { ring: LonLat[]; label: string | null } | null = null;
  let count = 0;
  for (const f of features) {
    for (const ring of ringsFromGeometry(f.geometry ?? {})) {
      if (ring.length < 2) continue;
      count++;
      const label =
        (f.properties?.["name"] as string | undefined) ??
        (f.properties?.["nome"] as string | undefined) ??
        null;
      if (!best || polygonAreaM2(ring) > polygonAreaM2(best.ring)) {
        best = { ring, label };
      }
    }
  }
  if (!best) return null;
  if (count > 1) {
    warnings.push(`O arquivo contém ${count} geometrias; foi utilizada a de maior área.`);
  }
  return buildParcel(best.label, best.ring, warnings);
}

export const GEO_EXTENSIONS = ["kml", "kmz", "geojson"];

export function isGeoExtension(extension: string | null | undefined): boolean {
  const ext = (extension ?? "").toLowerCase().replace(".", "");
  return GEO_EXTENSIONS.includes(ext);
}

/** Detecta o formato e devolve a parcela normalizada. */
export function parseGeometryText(text: string): ParsedParcel | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return parseGeoJson(trimmed);
  if (trimmed.includes("<kml") || trimmed.includes("<coordinates>")) return parseKml(trimmed);
  return parseGeoJson(trimmed) ?? parseKml(trimmed);
}

/** Todos os polígonos de um KML, na ordem em que aparecem (Placemarks). */
export function parseKmlPolygons(xml: string): ParsedParcel[] {
  const placemarks = [...xml.matchAll(/<Placemark[\s\S]*?<\/Placemark>/gi)].map(
    (m) => m[0]!,
  );
  const fontes = placemarks.length > 0 ? placemarks : [xml];
  const parcelas: ParsedParcel[] = [];
  for (const fonte of fontes) {
    const outers = [
      ...fonte.matchAll(
        /<outerBoundaryIs[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/outerBoundaryIs>/gi,
      ),
    ].map((m) => m[1]!);
    const blocks =
      outers.length > 0
        ? outers
        : [...fonte.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)].map(
            (m) => m[1]!,
          );
    const nameMatch = /<name>([\s\S]*?)<\/name>/i.exec(fonte);
    const label = nameMatch ? nameMatch[1]!.replace(/<[^>]+>/g, "").trim() : null;
    blocks
      .map(parseKmlCoordinates)
      .filter((r) => r.length >= 3)
      .forEach((ring) => parcelas.push(buildParcel(label || null, ring, [])));
  }
  return parcelas;
}

/** Todos os polígonos de um GeoJSON. */
export function parseGeoJsonPolygons(raw: string): ParsedParcel[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const obj = json as Record<string, unknown>;
  const features: { geometry?: GeoJsonGeometry; properties?: Record<string, unknown> }[] =
    [];
  if (obj["type"] === "FeatureCollection" && Array.isArray(obj["features"])) {
    features.push(...(obj["features"] as typeof features));
  } else if (obj["type"] === "Feature") {
    features.push(obj as (typeof features)[number]);
  } else {
    features.push({ geometry: obj as GeoJsonGeometry });
  }
  const parcelas: ParsedParcel[] = [];
  for (const f of features) {
    const label =
      (f.properties?.["name"] as string | undefined) ??
      (f.properties?.["nome"] as string | undefined) ??
      (f.properties?.["matricula"] as string | undefined) ??
      null;
    for (const ring of ringsFromGeometry(f.geometry ?? {})) {
      if (ring.length < 3) continue;
      parcelas.push(buildParcel(label, ring, []));
    }
  }
  return parcelas;
}

/** Detecta o formato e devolve TODAS as parcelas descritas no arquivo. */
export function parseGeometryPolygons(text: string): ParsedParcel[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return parseGeoJsonPolygons(trimmed);
  if (trimmed.includes("<kml") || trimmed.includes("<coordinates>"))
    return parseKmlPolygons(trimmed);
  const json = parseGeoJsonPolygons(trimmed);
  return json.length > 0 ? json : parseKmlPolygons(trimmed);
}
