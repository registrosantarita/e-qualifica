import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMemorial } from "./memorial-parser.ts";

const exemplo = `A poligonal inicia no ponto 1, de coordenadas Latitude:-21°34'22,47460"S e Longitude:-47°30'11,01434"W, referidas ao Sistema Geocêntrico SIRGAS 2000, situado no Km 47+234,84m da LT; deste segue com azimute de 46º06'35'' e distância de 5,36m, confrontando com terras de SYLVAMO DO BRASIL LTDA até atingir o ponto 2, de coordenadas Latitude:-21°34'22,35574"S e Longitude:-47°30'10,87782"W;`;

test("até atingir liga a origem à chegada com as medidas e coordenadas", () => {
  const parcel = parseMemorial(exemplo);
  assert.equal(parcel.segments.length, 1);
  const segment = parcel.segments[0];
  assert.equal(segment.from_vertex, "1");
  assert.equal(segment.to_vertex, "2");
  assert.equal(segment.distance_m, 5.36);
  assert.equal(segment.confrontante, "terras de SYLVAMO DO BRASIL LTDA");
  assert.ok(Math.abs(segment.azimuth_deg - (46 + 6 / 60 + 35 / 3600)) < 0.000001);
  assert.ok(Math.abs(parcel.vertices.find((v) => v.name === "1").lat + 21.57290961) < 0.0000001);
  assert.ok(Math.abs(parcel.vertices.find((v) => v.name === "2").lon + 47.50302162) < 0.0000001);
});

test("chegadas sucessivas não geram segmentos vazios", () => {
  const parcel = parseMemorial(`${exemplo} Deste segue com azimute de 90º00'00'' e distância de 8,00m, confrontando com terras de MARIA até atingir o ponto 3, de coordenadas Latitude:-21°34'22,35574"S e Longitude:-47°30'10,60000"W;`);
  assert.deepEqual(parcel.segments.map((s) => [s.from_vertex, s.to_vertex, s.distance_m]), [
    ["1", "2", 5.36], ["2", "3", 8],
  ]);
  assert.equal(parcel.segments[1].confrontante, "terras de MARIA");
});