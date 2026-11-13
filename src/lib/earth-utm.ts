import proj4 from "proj4";
import type { ParcelExport, VertexCoordRow } from "./export-registral";

export type EarthUtmReference = { zone: number; hemisphere: "S" | "N"; datum: "SIRGAS2000" | "WGS84" };
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const geographicVertex = (v: VertexCoordRow) => finite(v.lon) && Math.abs(v.lon) <= 180 && finite(v.lat) && Math.abs(v.lat) <= 90;
export function needsEarthUtm(parcel: ParcelExport): boolean {
  const raw = parcel.raw_extraction as { vertices?: VertexCoordRow[] } | null;
  return (raw?.vertices ?? []).some(v => !geographicVertex(v) && finite(v.east) && finite(v.north));
}

/** Converts only an export copy; extracted coordinates and source precision remain unchanged. */
export function earthGeographicParcel(parcel: ParcelExport, reference?: EarthUtmReference): ParcelExport {
  const raw = parcel.raw_extraction as { vertices?: VertexCoordRow[] } | null;
  const vertices = (raw?.vertices ?? []).map(v => {
    if (geographicVertex(v) || !finite(v.east) || !finite(v.north)) return v;
    if (!reference) throw new Error("Informe o fuso, hemisfério e datum das coordenadas UTM para converter ao Google Earth.");
    if (!Number.isInteger(reference.zone) || reference.zone < 1 || reference.zone > 60 || !["S", "N"].includes(reference.hemisphere) || !["SIRGAS2000", "WGS84"].includes(reference.datum)) {
      throw new Error("Referência UTM inválida; confira fuso (1 a 60), hemisfério e datum.");
    }
    if (v.east < 100000 || v.east > 900000 || v.north < 0 || v.north > 10000000) throw new Error(`Coordenadas UTM do vértice ${v.name} fora dos limites; confira o documento.`);
    const source = `+proj=utm +zone=${reference.zone} ${reference.hemisphere === "S" ? "+south " : ""}${reference.datum === "SIRGAS2000" ? "+ellps=GRS80 +towgs84=0,0,0" : "+datum=WGS84"} +units=m +no_defs`;
    const [lon, lat] = proj4(source, "WGS84", [v.east, v.north]);
    if (!finite(lon) || !finite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error(`Não foi possível converter o vértice ${v.name}.`);
    return { ...v, lon, lat, lon_raw: null, lat_raw: null };
  });
  return { ...parcel, raw_extraction: { ...raw, vertices } };
}