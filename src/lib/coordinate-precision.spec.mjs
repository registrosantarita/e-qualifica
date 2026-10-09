import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeoCoord, parseMemorial } from "./memorial-parser.ts";
import { coordToDms } from "./labels.ts";
import { buildDescricaoSheets } from "./export-registral.ts";
import { parseGeoJson } from "./geo-parser.ts";

test("coordenadas decimais não são arredondadas na ingestão", () => {
  for (const text of ["-21,123456", "-47,123456789012", "-21.987654321098"]) {
    assert.equal(parseGeoCoord(text), Number(text.replace(",", ".")));
  }
});

test("seis casas de segundo e zeros finais sobrevivem à leitura e exportação", () => {
  const lon = `-47°30'56,180998"W`;
  const lat = `-21°33'49,462650"S`;
  const parcel = parseMemorial(`VERTICE | VANTE | LONGITUDE | LATITUDE | AZIMUTE | DISTANCIA
V1 | V2 | ${lon} | ${lat} | 90°00'00" | 10,00
V2 | V3 | -47°30'55,180998"W | -21°33'49,462650"S | 180°00'00" | 10,00
V3 | V1 | -47°30'55,180998"W | -21°33'50,462650"S | 270°00'00" | 10,00`);
  const vertex = parcel.vertices.find((v) => v.name === "V1");
  assert.ok(vertex);
  assert.equal(vertex.lon_raw, lon);
  assert.equal(vertex.lat_raw, lat);
  assert.equal(vertex.lon, -(47 + 30 / 60 + 56.180998 / 3600));
  assert.equal(coordToDms(vertex.lon, "lon", vertex.lon_raw), lon);
  assert.equal(coordToDms(vertex.lat, "lat", vertex.lat_raw), lat);
  const sheets = buildDescricaoSheets({ ...parcel, raw_extraction: JSON.parse(JSON.stringify({ vertices: parcel.vertices })) });
  assert.equal(sheets.perimetro[1][1], lon);
  assert.equal(sheets.perimetro[1][2], lat);
});

test("caminhamento em prosa mantém a precisão literal das coordenadas", () => {
  const lon = `-47°30'11,014340"W`;
  const lat = `-21°34'22,474600"S`;
  const parcel = parseMemorial(`A poligonal inicia no ponto 1, de coordenadas Latitude:${lat} e Longitude:${lon}; deste segue com azimute de 46º06'35'' e distância de 5,36m, confrontando com terras de SYLVAMO até atingir o ponto 2, de coordenadas Latitude:-21°34'22,355740"S e Longitude:-47°30'10,877820"W;`);
  const vertex = parcel.vertices.find((v) => v.name === "1");
  assert.ok(vertex);
  assert.equal(vertex.lon_raw, lon);
  assert.equal(vertex.lat_raw, lat);
});

test("GeoJSON conserva os valores de latitude e longitude recebidos", () => {
  const lon = -47.123456789012;
  const lat = -21.123456789012;
  const parcel = parseGeoJson(JSON.stringify({ type: "Polygon", coordinates: [[[lon, lat], [lon + 0.001, lat], [lon, lat + 0.001], [lon, lat]]] }));
  assert.equal(parcel?.vertices[0].lon, lon);
  assert.equal(parcel?.vertices[0].lat, lat);
});