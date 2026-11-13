import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseParcelas } from "./multi-parcel.ts";
import { needsGeoconfrontoOcr } from "./geoconfronto-text-quality.ts";
import { compareOverlay, readOverlay } from "./overlay-engine.ts";
import { DEFAULT_TOLERANCES } from "./comparison-engine.ts";

const fixture = name => readFileSync(new URL(`./fixtures/monte-alegre-${name}.txt`, import.meta.url), "utf8");
const registry = fixture("matricula"), memorial = fixture("glebas");
const geometry = () => [registry, memorial].flatMap(t => parseParcelas(t, false)).map(p => ({ ...p, raw_extraction: { vertices: p.vertices } }));

test("matrícula 21.594 com OCR defeituoso exige releitura, sem aceitar coordenadas parciais", () => {
  assert.equal(needsGeoconfrontoOcr(fixture("camada-ocr")), true);
  assert.equal(needsGeoconfrontoOcr(registry), false);
  assert.equal(needsGeoconfrontoOcr(memorial), false);
});

test("perímetro da matrícula encerra em 117 trechos sem incluir a servidão e confrontações", () => {
  const p = parseParcelas(registry, false)[0];
  assert.equal(p.segments.length, 117);
  assert.equal(p.vertices.length, 117);
  assert.equal(p.area_m2, 3077068);
  assert.equal(p.declared_perimeter_m, 9083.04);
  assert.equal(p.segments.at(-1).to_vertex, "FAF-V-1386");
  assert.equal(p.segments[0].azimuth_deg, 111.35);
  assert.equal(p.vertices.some(v => v.lat === null || v.lon === null), false);
});

test("memorial preserva as duas glebas independentes de 149 e 66 trechos", () => {
  const ps = parseParcelas(memorial, false);
  assert.deepEqual(ps.map(p => p.segments.length), [149, 66]);
  assert.deepEqual(ps.map(p => p.area_m2), [2832423, 244645]);
  assert.equal(ps[0].area_m2 + ps[1].area_m2, 3077068);
  assert.deepEqual(ps.map(p => p.segments.at(-1).to_vertex), ["FAF-V-1386", "CYEP-M-0676"]);
});

test("Sobreposição real é calculável e mantém pequenas divergências das coordenadas publicadas", () => {
  const result = compareOverlay(geometry(), ["Matrícula", "Gleba 1", "Gleba 2"], DEFAULT_TOLERANCES);
  assert.notEqual(result.classification, "inconclusive");
  const o = readOverlay(result.metrics);
  assert.ok(o);
  assert.equal(o.overlapM2, 0);
  assert.ok(o.gapM2 > 0.21 && o.gapM2 < 0.22);
  assert.ok(o.outsideM2 > 0.31 && o.outsideM2 < 0.32);
  assert.ok(o.boundaryDeviationM > 0.002 && o.boundaryDeviationM < 0.003);
  assert.deepEqual(o.missingTotalVertices, []);
  assert.equal(o.polygons.slice(1).flat().filter(v => v.newVertex).length, 98);
  assert.equal(compareOverlay(geometry(), ["Matrícula", "Gleba 1", "Gleba 2"], { ...DEFAULT_TOLERANCES, areaM2: 0.5, distanceM: 0.005 }).classification, "compatible");
});

test("falha de caminhamento identifica o documento afetado sem forçar compatibilidade", () => {
  const ps = geometry();
  ps[0].segments.pop();
  const result = compareOverlay(ps, ["Matrícula", "Gleba 1", "Gleba 2"], DEFAULT_TOLERANCES);
  assert.equal(result.classification, "inconclusive");
});