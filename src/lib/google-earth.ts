import type { ParcelExport, VertexCoordRow } from "./export-registral";
import { montarKml } from "./export-geometria";
import { earthGeographicParcel, type EarthUtmReference } from "./earth-utm";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function earthKml(parcels: ParcelExport[], references: (EarthUtmReference | undefined)[] = []): { text: string; lat: number; lon: number } {
  const placemarks: string[] = [];
  let center: VertexCoordRow | undefined;
  for (const [index, source] of parcels.entries()) {
    const parcel = earthGeographicParcel(source, references[index]);
    const raw = parcel.raw_extraction as { vertices?: VertexCoordRow[] } | null;
    const vertices = raw?.vertices ?? [];
    const valid = vertices.filter(v => typeof v.lon === "number" && Number.isFinite(v.lon) && Math.abs(v.lon) <= 180 && typeof v.lat === "number" && Number.isFinite(v.lat) && Math.abs(v.lat) <= 90);
    if (!valid.length) throw new Error("Não há latitude e longitude válidas neste documento.");
    center ??= valid[0];
    if (parcel.segments.length) {
      const kml = montarKml(parcel);
      const mark = kml.match(/<Placemark>[\s\S]*?<\/Placemark>/)?.[0];
      if (mark) placemarks.push(mark);
    } else {
      valid.forEach(v => placemarks.push(`<Placemark><name>${escape(`${parcel.label ?? "Documento"} — ${v.name}`)}</name><Point><coordinates>${v.lon},${v.lat}</coordinates></Point></Placemark>`));
    }
  }
  if (!center || center.lat === null || center.lon === null || !placemarks.length) throw new Error("Nenhuma geometria georreferenciada disponível.");
  return { text: `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${placemarks.join("\n")}</Document></kml>`, lat: center.lat, lon: center.lon };
}