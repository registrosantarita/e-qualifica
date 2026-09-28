import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMemorial } from "./memorial-parser.ts";
import { parseParcelas } from "./multi-parcel.ts";
import { extractPdfText, removeRepeatedPdfPageHeaders, removeRepeatedPdfPageFooters } from "./extraction.server.ts";
import { readFileSync } from "node:fs";

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

test("cabeçalhos repetidos não interrompem a distância e o vértice entre páginas", () => {
  const header = "Empresa\nSetor técnico\nContato\n";
  const pages = [
    `${header}Página 4 de 15\nA poligonal inicia no ponto 1, de coordenadas Latitude:-21°33'49,08176\"S e Longitude:-47°30'55,85580\"W; deste segue com azimute de 127º35'23'' e distância de`,
    `${header}Página 5 de 15\n126,89m, confrontando com terras de SYLVAMO até atingir o ponto 2, de coordenadas Latitude:-21°33'55,88349\"S e Longitude:-47°30'45,90035\"W; deste segue com azimute de 55º23'47'' e distância de 6,84m, confrontando com terras de JOSÉ até atingir o`,
    `${header}Página 6 de 15\nponto 1, de coordenadas Latitude:-21°33'49,08176\"S e Longitude:-47°30'55,85580\"W;`,
  ];
  const text = removeRepeatedPdfPageHeaders(pages).join("\n");
  const parcel = parseMemorial(text);
  assert.deepEqual(parcel.segments.map((s) => [s.from_vertex, s.to_vertex, s.distance_m]), [["1", "2", 126.89], ["2", "1", 6.84]]);
  assert.deepEqual(removeRepeatedPdfPageHeaders(["A\nPágina 1 de 2\ntexto", "B\nPágina 2 de 2\ntexto"]), ["A\nPágina 1 de 2\ntexto", "B\nPágina 2 de 2\ntexto"]);
});

test("rodapé de assinatura colado ao confrontante não suprime o trecho entre páginas", () => {
  const assinatura = "Esse documento foi assinado por FULANO.\nPara validar o documento e suas assinaturas acesse https://exemplo.test/valida e informe o código ABC-\nXYZ";
  const pages = [
    `A poligonal inicia no ponto 13, de coordenadas Latitude:-21°33'54,07850\"S e Longitude:-47°30'49,99857\"W; deste segue com azimute de 307º35'23'' e distância de 69,18m, confrontando com terras de SYLVAMO DO${assinatura}`,
    `BRASIL LTDA até atingir o ponto 14, de coordenadas Latitude:-21°33'52,67847\"S e Longitude:-47°30'51,87925\"W; deste segue com azimute de 307º42'16'' e distância de 158,50m, confrontando com terras de SYLVAMO DO${assinatura}`,
    `BRASIL LTDA até atingir o ponto 15, de coordenadas Latitude:-21°33'49,462657\"S e Longitude:-47°30'56,180998\"W;`,
  ];
  const cleaned = removeRepeatedPdfPageFooters(pages);
  assert.ok(!cleaned.join(' ').includes('Esse documento foi assinado'));
  const parsed = parseMemorial(cleaned.join('\n'));
  assert.deepEqual(parsed.segments.map((s) => [s.from_vertex, s.to_vertex, s.distance_m]), [['13', '14', 69.18], ['14', '15', 158.5]]);
  assert.deepEqual(removeRepeatedPdfPageFooters([pages[0], 'Outro documento sem rodapé']), [pages[0], 'Outro documento sem rodapé']);
});

test("os PDFs da prenotação 91.356 preservam 13→14 na escritura e no instrumento", async () => {
  const files = ['02._Escritura_Pública-2.PDF', '03._Instrumento_Particular-2.PDF'];
  for (const name of files) {
    let bytes;
    try { bytes = readFileSync(`/mnt/user-uploads/${name}`); } catch { continue; }
    const text = await extractPdfText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const parcels = parseParcelas(text, false);
    assert.equal(parcels.length, 1, name);
    assert.equal(parcels[0].segments.length, 17, name);
    assert.deepEqual(parcels[0].segments.slice(12, 14).map((s) => [s.from_vertex, s.to_vertex, s.distance_m]), [['13', '14', 69.18], ['14', '15', 158.5]], name);
  }
});

test("os dois PDFs enviados produzem o mesmo caminhamento completo", async () => {
  const names = ["Escritura", "Memorial"];
  const files = names.map((name) => `/mnt/user-uploads/${name}.pdf`);
  if (!files.every((file) => { try { readFileSync(file); return true; } catch { return false; } })) return;
  const parsed = await Promise.all(files.map(async (file) => {
    const bytes = readFileSync(file);
    const text = await extractPdfText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return parseParcelas(text, false)[0];
  }));
  for (const parcel of parsed) {
    assert.equal(parcel.segments.length, 17);
    assert.equal(parcel.segments[6].to_vertex, "8");
    assert.equal(parcel.segments[6].distance_m, 126.89);
    assert.equal(parcel.segments.at(-1).to_vertex, "1");
  }
  assert.deepEqual(parsed[0].segments.map((s) => [s.from_vertex, s.to_vertex, s.distance_m, s.azimuth_deg]), parsed[1].segments.map((s) => [s.from_vertex, s.to_vertex, s.distance_m, s.azimuth_deg]));
});

test("análise 91369: os dois memoriais preservam 50 trechos, sem aceitar distâncias corrompidas", async () => {
  const files = ["04._Memorial_Descritivo-4.pdf", "06._Memorial_Descritivo_-_SIGEF-2.pdf"];
  if (!files.every((name) => { try { readFileSync(`/mnt/user-uploads/${name}`); return true; } catch { return false; } })) return;
  const parsed = await Promise.all(files.map(async (name) => {
    const bytes = readFileSync(`/mnt/user-uploads/${name}`);
    const text = await extractPdfText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return parseParcelas(text, false)[0];
  }));
  for (const parcel of parsed) {
    assert.equal(parcel.segments.length, 50);
    assert.ok(parcel.segments.some((s) => s.from_vertex === "CYEP-V-0876" && s.to_vertex === "CYEP-V-0877"));
    assert.ok(parcel.segments.some((s) => s.from_vertex === "CYEP-V-0885" && s.to_vertex === "CYEP-V-0886"));
    assert.ok(!parcel.segments.some((s) => s.distance_m > 500));
  }
  assert.equal(parsed[0].segments.find((s) => s.to_vertex === "CYEP-V-0881").distance_m, null);
  assert.equal(parsed[0].computed_perimeter_m, null);
  assert.ok(parsed[0].warnings.some((w) => w.includes("distância não confirmada")));
  assert.equal(parsed[1].segments.find((s) => s.to_vertex === "CYEP-V-0881").distance_m, 20.48);
  assert.ok(Math.abs(parsed[1].computed_perimeter_m - 2803.78) < 1);
});

test("saltos na numeração e divergência perimetral exigem conferência, sem fabricar vértices", () => {
  const text = `Perímetro: 30,00 m. Inicia-se no vértice ABC-001 (Longitude -47°29'00,000\" Latitude -21°44'00,000\" Altitude 600 m); 90º00' e 10,00 m até o vértice ABC-003 (Longitude -47°28'59,700\" Latitude -21°44'00,000\" Altitude 600 m); 90º00' e 10,00 m até o vértice ABC-004 (Longitude -47°28'59,400\" Latitude -21°44'00,000\" Altitude 600 m); 90º00' e 10,00 m até o vértice ABC-005 (Longitude -47°28'59,100\" Latitude -21°44'00,000\" Altitude 600 m);`;
  const parcel = parseMemorial(text);
  assert.ok(parcel.warnings.some((w) => w.includes("ABC-001 → ABC-003")));
  assert.ok(!parcel.segments.some((s) => s.to_vertex === "ABC-002"));
});

test("escritura e instrumento particular separam dez faixas sem duplicar os anexos", async () => {
  for (const [name, expected] of [
    ["02._Escritura_Pública.PDF", [26286, 3792, 96, 73179, 109, 76, 2929, 2111, 3998, 2485]],
    ["03._Instrumento_Particular.PDF", [26286, 3792, 96, 73179, 109, 76, 2929, 2111, 3998, 2485]],
  ]) {
    const file = `/mnt/user-uploads/${name}`;
    let bytes;
    try { bytes = readFileSync(file); } catch { continue; }
    const text = await extractPdfText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const parcels = parseParcelas(text, false);
    assert.equal(parcels.length, 10, name);
    assert.deepEqual(parcels.map((p) => Math.round(p.area_m2)), expected, name);
    assert.ok(parcels.every((p) => p.segments.length >= 3), name);
    assert.ok(parcels.every((p) => p.label.includes("RPR_POF")), name);
  }
});