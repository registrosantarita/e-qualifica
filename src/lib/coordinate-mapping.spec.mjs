import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMemorial, parseGeoCoord } from "./memorial-parser.ts";
import { buildDescricaoSheets } from "./export-registral.ts";

const lon = `-47°30'11,014340"`;
const lat = `-21°34'22,474600"`;
const pair = (reverse) => reverse ? `Latitude: ${lat} e Longitude: ${lon}` : `Longitude: ${lon} e Latitude: ${lat}`;

test("a conjunção e não é sufixo de longitude nem de latitude na prosa", () => {
  for (const reverse of [false, true]) {
    const parcel = parseMemorial(`Inicia no vértice V1, de coordenadas (${pair(reverse)} e Altitude: 700); segue 90°00' e 10,00 m até o vértice V2, (${pair(reverse)} e Altitude: 701); segue 180°00' e 10,00 m até o vértice V3, (${pair(!reverse)} e Altitude: 702); segue 270°00' e 10,00 m até o vértice V1, (${pair(reverse)} e Altitude: 700).`);
    assert.equal(parcel.segments.length, 3);
    assert.equal(parcel.vertices.length, 3);
    for (const v of parcel.vertices) {
      assert.equal(v.lon_raw, lon);
      assert.equal(v.lat_raw, lat);
      assert.equal(v.lon, parseGeoCoord(lon));
      assert.equal(v.lat, parseGeoCoord(lat));
    }
  }
});

test("caminhamento até atingir o ponto exclui a conjunção depois da longitude", () => {
  const parcel = parseMemorial(`Inicia no ponto 1, de coordenadas ${pair(false)} e Altitude: 700; segue com azimute de 90°00'00" e distância de 10m, confrontando com terras até atingir o ponto 2, de coordenadas ${pair(true)} e Altitude: 701;`);
  assert.equal(parcel.vertices[0].lon_raw, lon);
  assert.equal(parcel.vertices[1].lon_raw, lon);
});

test("hemisférios E e W autênticos não são removidos", () => {
  for (const hemisphere of ["E", "e", "W", "w"]) {
    const eastLon = `47°30'11,014340"${hemisphere}`;
    const parcel = parseMemorial(`Inicia no ponto 1, de coordenadas Latitude: ${lat}S e Longitude: ${eastLon}; segue com azimute de 90°00'00" e distância de 10m até atingir o ponto 2, de coordenadas Latitude: ${lat}S e Longitude: ${eastLon};`);
    assert.equal(parcel.vertices[0].lon_raw, eastLon);
    assert.equal(parcel.vertices[0].lon, /w/i.test(hemisphere) ? -parseGeoCoord(eastLon.replace(/[Ww]$/, "")) : parseGeoCoord(eastLon));
  }
});

test("tabela tipo SIGEF respeita latitude primeiro, com separadores e espaços simples", () => {
  for (const separator of [" | ", ";", "\t", " ", "   "]) {
    for (const reverse of [false, true]) {
      const header = ["De", ...(reverse ? ["Longitude", "Latitude"] : ["Latitude", "Longitude"]), "Altitude", "Para", "Azimute", "Distância"].join(separator);
      const rows = [1, 2, 3].map((i) => [`V${i}`, ...(reverse ? [lon, lat] : [lat, lon]), "700", `V${i % 3 + 1}`, `90°00'00"`, "10,00"].join(separator));
      const parcel = parseMemorial([header, ...rows].join("\n"));
      assert.equal(parcel.vertices.length, 3, separator);
      assert.equal(parcel.segments.length, 3, separator);
      for (const v of parcel.vertices) {
        assert.equal(v.lon_raw, lon, separator);
        assert.equal(v.lat_raw, lat, separator);
      }
      const sheets = buildDescricaoSheets({ ...parcel, raw_extraction: { vertices: parcel.vertices } });
      assert.equal(sheets.perimetro[1][1], lon);
      assert.equal(sheets.perimetro[1][2], lat);
    }
  }
});

test("tabela reordenada preserva coordenadas decimais e colunas vazias", () => {
  const parcel = parseMemorial(`De;Latitude;Altitude;Longitude;Para;Distância;Azimute
V1;-21.123456;700;-47.123456789012;V2;10;90°00'
V2;-21.234560;701;;V3;10;180°00'
V3;-21.345600;702;-47.234567890123;V1;10;270°00'`);
  assert.equal(parcel.vertices[0].lon, -47.123456789012);
  assert.equal(parcel.vertices[0].lat_raw, "-21.123456");
  assert.equal(parcel.vertices[1].lon, null);
  assert.equal(parcel.vertices[1].lat_raw, "-21.234560");
});

test("planta Santa Rita associa as 109 coordenadas aos mesmos eixos do SIGEF", () => {
  const fixture = (name) => readFileSync(new URL(`./fixtures/santa-rita-${name}.txt`, import.meta.url), "utf8");
  const plant = parseMemorial(fixture("planta"));
  const memorial = parseMemorial(fixture("sigef"));
  assert.equal(plant.vertices.length, 109);
  assert.equal(memorial.vertices.length, 109);
  // The plan has different source codes; never overwrite them to match SIGEF.
  for (const [index, vertex] of plant.vertices.entries()) {
    const expected = memorial.vertices[index];
    assert.ok(expected, vertex.name);
    if (vertex.name === "SWTM-M-0420") {
      assert.equal(vertex.lon_raw, `-47°21'47.485"`);
      assert.equal(vertex.lat_raw, `-21°45'37.356"`);
      assert.equal(expected.lon_raw, `-47°21'47,484"`);
      assert.equal(expected.lat_raw, `-21°45'37,357"`);
      assert.notEqual(vertex.lon, expected.lon);
      assert.notEqual(vertex.lat, expected.lat);
      continue;
    }
    assert.equal(vertex.lon, expected.lon, vertex.name);
    assert.equal(vertex.lat, expected.lat, vertex.name);
  }
});

test("cabeçalhos repetidos atualizam a ordem sem trocar os eixos nas próximas páginas", () => {
  const parcel = parseMemorial(`De Latitude Longitude Altitude Para Azimute Distância
V1 ${lat} ${lon} 700 V2 90°00'00" 10,00
De Longitude Latitude Altitude Para Azimute Distância
V2 ${lon} ${lat} 701 V3 180°00'00" 10,00
V3 ${lon} ${lat} 702 V1 270°00'00" 10,00`);
  assert.equal(parcel.vertices.length, 3);
  for (const vertex of parcel.vertices) {
    assert.equal(vertex.lon_raw, lon);
    assert.equal(vertex.lat_raw, lat);
  }
});