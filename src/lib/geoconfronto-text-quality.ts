import { parseParcelas } from "./multi-parcel";

/** A populated text layer is not proof that a scanned walking description is readable. */
export function needsGeoconfrontoOcr(text: string): boolean {
  if (text.trim().length < 40) return true;
  const parcels = parseParcelas(text, false);
  const table = /longitude[\s\S]{0,100}latitude|latitude[\s\S]{0,100}longitude/i.test(text) &&
    /(?:segmento\s+vante|confronta[çc][õo]es|azim\.?|[âa]ngulo|dist\.?)/i.test(text);
  if (table && !/at[ée]\s+(?:o\s+)?v[ée]rtice/i.test(text)) {
    const parcel = parcels[0];
    if (!parcel || !parcel.segments.length) return true;
    const last = parcel.segments.at(-1);
    const closed = last?.to_vertex?.toUpperCase() === parcel.segments[0]?.from_vertex?.toUpperCase();
    const end = closed && last ? text.indexOf(last.raw_text) : -1;
    const scope = end >= 0 && last ? text.slice(0, end + last.raw_text.length) : text;
    const rows = [...scope.matchAll(/^\s*\|?\s*([A-Z][\w.-]*\d)\s*[|;\t ]+\s*(?=-?\d{1,3}\s*[°ºo]|\[ileg[ií]vel\])/gim)];
    const expected = new Set(rows.map((m) => m[1]?.toUpperCase()));
    if (parcel.vertices.some(v => v.lon === null || v.lat === null || Math.abs(v.lon) > 180 || Math.abs(v.lat) > 90) ||
      parcel.segments.some((s, i) => s.distance_m === null || s.azimuth_deg === null ||
        (i > 0 && s.from_vertex?.toUpperCase() !== parcel.segments[i - 1]?.to_vertex?.toUpperCase()))) return true;
    if (expected.size >= 3) {
      return parcel.segments.length < expected.size || parcel.vertices.length < expected.size ||
        parcel.vertices.some((v) => v.lon === null || v.lat === null || Math.abs(v.lon) > 180 || Math.abs(v.lat) > 90) ||
        parcel.segments.some((s) => s.distance_m === null || s.azimuth_deg === null) || /\[ileg[ií]vel\]/i.test(scope);
    }
  }
  const destinations = [...text.matchAll(/at[ée]\s+(?:atingir\s+)?(?:o\s+)?(?:v[ée]rtice|ponto|marco|estaca)\s+([A-Z0-9][\w.-]*)/gi)];
  if (destinations.length < 3 || !/coordenadas|longitude|latitude/i.test(text)) return false;
  const usable = parcels.flatMap(parcel => parcel.segments).filter((s) => s.to_vertex && s.distance_m !== null && s.azimuth_deg !== null);
  if (usable.length < destinations.length) return true;
  // Missing coordinate punctuation must be re-read, never reconstructed from the other PDF.
  return /\[ileg[ií]vel\]/i.test(text) || parcels.flatMap(p => p.vertices).length < new Set(destinations.map((m) => m[1]?.toUpperCase())).size ||
    parcels.some(p => p.vertices.some((v) => v.lon === null || v.lat === null));
}