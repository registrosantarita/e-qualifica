import { parseMemorial } from "./memorial-parser";

/** A populated text layer is not proof that a scanned walking description is readable. */
export function needsGeoconfrontoOcr(text: string): boolean {
  if (text.trim().length < 40) return true;
  const destinations = [...text.matchAll(/at[ée]\s+(?:o\s+)?v[ée]rtice\s+([A-Z0-9][\w.-]*)/gi)];
  if (destinations.length < 3 || !/coordenadas/i.test(text)) return false;
  const parcel = parseMemorial(text);
  const usable = parcel.segments.filter((s) => s.to_vertex && s.distance_m !== null && s.azimuth_deg !== null);
  if (usable.length < destinations.length) return true;
  // Missing coordinate punctuation must be re-read, never reconstructed from the other PDF.
  return parcel.vertices.length < new Set(destinations.map((m) => m[1]?.toUpperCase())).size ||
    parcel.vertices.some((v) => v.lon === null || v.lat === null);
}