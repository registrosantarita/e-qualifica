import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMemorial } from "./memorial-parser.ts";
import { needsGeoconfrontoOcr } from "./geoconfronto-text-quality.ts";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("Boa Vista: camada OCR danificada exige releitura sem inventar a vírgula ou coordenadas", () => {
  assert.equal(needsGeoconfrontoOcr(fixture("boa-vista-camada-ocr.txt")), true);
  assert.equal(needsGeoconfrontoOcr(fixture("boa-vista-prosa.txt")), false);
  assert.equal(needsGeoconfrontoOcr(fixture("boa-vista-sigef.txt")), false);
});

test("Boa Vista: oito trechos, coordenadas e altitudes coincidem após leitura independente dos dois PDFs", () => {
  const a = parseMemorial(fixture("boa-vista-prosa.txt"));
  const b = parseMemorial(fixture("boa-vista-sigef.txt"));
  assert.equal(a.segments.length, 8);
  assert.equal(b.segments.length, 8);
  assert.equal(a.vertices.length, 8);
  assert.equal(b.vertices.length, 8);
  assert.deepEqual(a.segments.map(s => [s.from_vertex, s.to_vertex, s.distance_m, s.azimuth_deg]), b.segments.map(s => [s.from_vertex, s.to_vertex, s.distance_m, s.azimuth_deg]));
  assert.deepEqual(a.vertices.map(v => [v.name, v.lon, v.lat, v.alt]), b.vertices.map(v => [v.name, v.lon, v.lat, v.alt]));
  assert.deepEqual(a.segments.map(s => s.distance_m), [247.57, 221.69, 143.49, 48.29, 133.95, 102.58, 239.65, 109.5]);
  for (const p of [a, b]) {
    assert.equal(p.area_m2, 67970);
    assert.equal(p.declared_perimeter_m, 1246.72);
    assert.equal(p.computed_perimeter_m, 1246.72);
  }
});