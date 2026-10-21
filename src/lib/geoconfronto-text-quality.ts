import { parseMemorial } from "./memorial-parser";

/** A populated text layer is not proof that a scanned walking description is readable. */
export function needsGeoconfrontoOcr(text: string): boolean {
  if (text.trim().length < 40) return true;
  const parcel = parseMemorial(text);
  const table = /longitude[\s\S]{0,100}latitude|latitude[\s\S]{0,100}longitude/i.test(text) &&
    /(?:segmento\s+vante|confronta[çc][õo]es|azim\.?)/i.test(text);
  if (table && !/at[ée]\s+(?:o\s+)?v[ée]rtice/i.test(text)) {
    const rows = [...text.matchAll(/^\s*([A-Z][\w.-]*\d)\s+(?=-?\d{1,3}\s*[°º]|\[ileg[ií]vel\])/gim)];
    const expected = new Set(rows.map((m) => m[1]?.toUpperCase()));
    if (expected.size >= 3) {
      return parcel.segments.length < expected.size || parcel.vertices.length < expected.size ||
        parcel.vertices.some((v) => v.lon === null || v.lat === null || Math.abs(v.lon) > 180 || Math.abs(v.lat) > 90) ||
        parcel.segments.some((s) => s.distance_m === null || s.azimuth_deg === null) || /\[ileg[ií]vel\]/i.test(text);
    }
  }
  const destinations = [...text.matchAll(/at[ée]\s+(?:atingir\s+)?(?:o\s+)?(?:v[ée]rtice|ponto|marco|estaca)\s+([A-Z0-9][\w.-]*)/gi)];
  if (destinations.length < 3 || !/coordenadas|longitude|latitude/i.test(text)) return false;
  const usable = parcel.segments.filter((s) => s.to_vertex && s.distance_m !== null && s.azimuth_deg !== null);
  if (usable.length < destinations.length) return true;
  // Missing coordinate punctuation must be re-read, never reconstructed from the other PDF.
  return /\[ileg[ií]vel\]/i.test(text) || parcel.vertices.length < new Set(destinations.map((m) => m[1]?.toUpperCase())).size ||
    parcel.vertices.some((v) => v.lon === null || v.lat === null);
}