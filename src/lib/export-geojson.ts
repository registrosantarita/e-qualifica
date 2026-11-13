import type { ParcelExport } from "./export-registral";
import { earthGeographicParcel, type EarthUtmReference } from "./earth-utm";
import { percurso } from "./export-geometria";

/** RFC 7946: longitude/latitude WGS84, closed rings; never reinterpret UTM as degrees. */
export function montarGeoJson(parcels: ParcelExport[], references: (EarthUtmReference | undefined)[] = []): string {
  if (!parcels.length) throw new Error("Nenhuma descrição perimétrica disponível.");
  const features = parcels.map((original, index) => {
    const parcel = earthGeographicParcel(original, references[index]);
    const { points, closed } = percurso(parcel);
    if (!closed) throw new Error("O Mapa exige um polígono fechado; confira o caminhamento antes de exportar.");
    const coordinates = points.map(p => {
      if (typeof p.lon !== "number" || !Number.isFinite(p.lon) || Math.abs(p.lon) > 180 || typeof p.lat !== "number" || !Number.isFinite(p.lat) || Math.abs(p.lat) > 90) throw new Error(`Coordenadas válidas ausentes no vértice ${p.name}.`);
      return [p.lon, p.lat];
    });
    // RFC 7946 recommends counterclockwise exterior rings.
    const signedArea = coordinates.reduce((sum, a, i) => {
      const b = coordinates[(i + 1) % coordinates.length];
      return sum + (a[0] ?? 0) * (b?.[1] ?? 0) - (b?.[0] ?? 0) * (a[1] ?? 0);
    }, 0);
    if (signedArea < 0) coordinates.reverse();
    const first = coordinates[0];
    if (!first) throw new Error("Polígono sem vértices.");
    coordinates.push([...first]);
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coordinates] },
      properties: {
        descricao: original.label,
        area_m2: original.area_m2 ?? null,
        perimetro_m: original.computed_perimeter_m ?? null,
        referencia_utm: references[index] ?? null,
        extracao_original: original.raw_extraction,
        trechos: [...original.segments].sort((a, b) => a.seq - b.seq).map(s => ({
          sequencia: s.seq, de: s.from_vertex, para: s.to_vertex,
          distancia_m: s.distance_m ?? null, azimute_graus: s.azimuth_deg ?? null,
          confrontante: s.confrontante ?? null,
        })),
      },
    };
  });
  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}