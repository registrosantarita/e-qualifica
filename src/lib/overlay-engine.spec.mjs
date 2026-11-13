import { test } from "node:test";
import assert from "node:assert/strict";
import { compareOverlay, readOverlay } from "./overlay-engine.ts";
import { DEFAULT_TOLERANCES } from "./comparison-engine.ts";

function parcel(coords, prefix = "V") {
  const vertices = coords.map(([east, north], i) => ({ name: `${prefix}${i}`, east, north, lon: null, lat: null, alt: null }));
  return { label: prefix, vertex_count: vertices.length, area_m2: null, declared_perimeter_m: null, computed_perimeter_m: null, raw_extraction: { vertices }, segments: vertices.map((v, i) => ({ seq: i + 1, from_vertex: v.name, to_vertex: vertices[(i + 1) % vertices.length].name })) };
}
const total = parcel([[0,0],[10,0],[10,10],[0,10]]);
const left = parcel([[0,0],[5,0],[5,10],[0,10]], "B");
const right = parcel([[5,0],[10,0],[10,10],[5,10]], "C");
const compare = (ps = [total, left, right], tol = DEFAULT_TOLERANCES, confirmed = true) => compareOverlay(ps, ["Total", "Gleba 1", "Gleba 2"], tol, confirmed);
test("duas glebas encaixam na área total sem lacunas ou sobreposição", () => {
  const r = compare(), o = readOverlay(r.metrics);
  assert.equal(r.classification, "compatible");
  assert.equal(o.totalAreaM2, 100); assert.deepEqual(o.parcelAreasM2, [50,50]);
  assert.equal(o.gapM2, 0); assert.equal(o.overlapM2, 0); assert.equal(o.outsideM2, 0);
  assert.deepEqual(o.missingTotalVertices, []);
});
test("novos vértices externos permitidos são identificados sem incompatibilidade", () => {
  const r = compare(), o = readOverlay(r.metrics);
  assert.equal(o.polygons.slice(1).flat().filter(v => v.newVertex && v.external).length, 4);
  assert.equal(r.findings.find(f => f.code === "OVERLAY_NEW_VERTICES").severity, "informative");
});
test("sobreposição entre glebas não é confundida com soma correta de áreas", () => {
  const r = compare([total, parcel([[0,0],[6,0],[6,10],[0,10]]), right]);
  assert.equal(readOverlay(r.metrics).overlapM2, 10);
  assert.equal(r.classification, "incompatible");
});
test("lacunas e extrapolação são calculadas separadamente", () => {
  const r = compare([total, left, parcel([[6,0],[11,0],[11,10],[6,10]])]);
  assert.equal(readOverlay(r.metrics).gapM2, 10); assert.equal(readOverlay(r.metrics).outsideM2, 10);
  assert.equal(r.classification, "incompatible");
});
test("vértice colinear original omitido recebe ressalva", () => {
  const r = compare([parcel([[0,0],[2,0],[10,0],[10,10],[0,10]]), left, right]);
  assert.equal(r.classification, "compatible_with_remarks");
  assert.deepEqual(readOverlay(r.metrics).missingTotalVertices, ["V1"]);
});
test("E/N sem confirmação de referência comum não produz compatibilidade", () => {
  assert.equal(compare(undefined, undefined, false).classification, "inconclusive");
});
test("caminhamento aberto ou coordenadas ausentes não são reconstruídos", () => {
  const broken = structuredClone(left); broken.segments.pop();
  assert.equal(compare([total, broken, right]).classification, "inconclusive");
  const missing = structuredClone(left); missing.raw_extraction.vertices[1].east = null;
  assert.equal(compare([total, missing, right]).classification, "inconclusive");
});
test("polígono que cruza a si próprio permanece inconclusivo", () => {
  assert.equal(compare([total, parcel([[0,0],[5,10],[5,0],[0,10]]), right]).classification, "inconclusive");
});
test("área e distância usam as tolerâncias adotadas", () => {
  const ps = [total, parcel([[0,0],[5.01,0],[5.01,10],[0,10]]), right];
  assert.equal(compare(ps).classification, "incompatible");
  assert.equal(compare(ps, { ...DEFAULT_TOLERANCES, areaM2: 0.11 }).classification, "compatible");
});
test("exige uma área total e exatamente duas glebas", () => {
  assert.equal(compare([total, left]).classification, "inconclusive");
});
test("novos vértices internos são destacados sem alterar o encaixe", () => {
  const r = compare([total, parcel([[0,0],[5,0],[5,5],[5,10],[0,10]]), parcel([[5,0],[10,0],[10,10],[5,10],[5,5]])]);
  assert.equal(r.classification, "compatible");
  assert.equal(readOverlay(r.metrics).polygons.slice(1).flat().filter(v => v.newVertex && !v.external).length, 2);
});
test("coordenadas geográficas são projetadas juntas mantendo tokens originais", () => {
  const ps = [total, left, right].map(p => { const copy = structuredClone(p); for (const v of copy.raw_extraction.vertices) { v.lon = -47 + v.east / 100000; v.lat = -21 + v.north / 100000; v.lon_raw = String(v.lon) + "000"; v.lat_raw = String(v.lat) + "000"; } return copy; });
  const r = compare(ps, { ...DEFAULT_TOLERANCES, areaM2: 0.01, distanceM: 0.01 });
  assert.equal(r.classification, "compatible");
  assert.match(readOverlay(r.metrics).reference, /UTM 23S/);
  assert.equal(readOverlay(r.metrics).polygons[0][0].lon_raw, "-47000");
});