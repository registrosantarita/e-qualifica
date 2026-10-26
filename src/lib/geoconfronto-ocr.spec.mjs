import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMemorial } from "./memorial-parser.ts";
import { needsGeoconfrontoOcr } from "./geoconfronto-text-quality.ts";
import { ocrDocument, ocrPdfPage } from "./ocr.server.ts";
import { PDFDocument } from "pdf-lib";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const prose = fixture("pedacinho-prosa.txt");
const sigef = fixture("pedacinho-sigef.txt");

test("digitalizado e SIGEF: 16 trechos com todas as distâncias e azimutes coincidentes", () => {
  const a = parseMemorial(prose), b = parseMemorial(sigef);
  assert.equal(a.segments.length, 16);
  assert.equal(b.segments.length, 16);
  assert.deepEqual(a.segments.map((s) => s.distance_m), [70.95, 4.23, 47.4, 53.36, 74.7, 280.09, 6.99, 22.08, 9.12, 19.46, 22.13, 47.37, 76, 99.07, 32.86, 98.7]);
  assert.deepEqual(a.segments.map((s) => [s.from_vertex, s.to_vertex, s.distance_m, s.azimuth_deg]), b.segments.map((s) => [s.from_vertex, s.to_vertex, s.distance_m, s.azimuth_deg]));
  assert.equal(a.area_m2, 19768);
  assert.equal(a.declared_perimeter_m, 964.53);
  assert.ok(Math.abs(a.computed_perimeter_m - 964.51) < 1e-8);
});

test("Long/Lat com hemisférios conserva coordenadas e casas decimais originais", () => {
  const a = parseMemorial(prose), b = parseMemorial(sigef);
  assert.equal(a.vertices.length, 16);
  for (const v of a.vertices) {
    const other = b.vertices.find((w) => w.name === v.name);
    assert.ok(other);
    assert.equal(v.lon, other.lon);
    assert.equal(v.lat, other.lat);
  }
  assert.equal(a.vertices[0].lon_raw, `47°22'01,208" W`);
  assert.equal(a.vertices[0].lat_raw, `21°41'11,453" S`);
});

test("diferença real de altitude não é corrigida para coincidir com SIGEF", () => {
  assert.equal(parseMemorial(prose).vertices.find((v) => v.name === "FAF-M-1856").alt, 714.05);
  assert.equal(parseMemorial(sigef).vertices.find((v) => v.name === "FAF-M-1856").alt, 714.5);
});

test("camada OCR longa com medida interrompida exige releitura; texto adequado dispensa IA", () => {
  assert.equal(needsGeoconfrontoOcr(prose), false);
  assert.equal(needsGeoconfrontoOcr(sigef), false);
  assert.equal(needsGeoconfrontoOcr(prose.replace("7°36' e de 9,12m", "7°36' e de ASSINATURA\n%%,9,12m")), true);
  assert.equal(needsGeoconfrontoOcr(prose.replace(`21°41'14,556"`, `21°4114,556"`)), true);
});

test("trecho não lido não desloca a origem dos trechos seguintes", () => {
  const parsed = parseMemorial(prose.replace("7°36' e de 9,12m", "7°36' e de [ilegível]m"));
  const next = parsed.segments.find((s) => s.to_vertex === "FAF-M-1861");
  assert.equal(next.from_vertex, "FAF-P-3246");
  assert.equal(next.distance_m, 19.46);
  assert.ok(parsed.warnings.some((w) => w.includes("Sequência incompleta")));
});

test("OCR interrompido não aceita uma transcrição parcial", async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.LOVABLE_API_KEY;
  process.env.LOVABLE_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: prose.slice(0, 200) }, finish_reason: "length" }] }));
  try {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const result = await ocrDocument(new Uint8Array(await pdf.save()).buffer, "pdf", "teste", { geoconfronto: true });
    assert.equal(result.text, "");
    assert.match(result.note, /interrompida/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LOVABLE_API_KEY; else process.env.LOVABLE_API_KEY = originalKey;
  }
});

test("OCR por etapa envia somente a página solicitada e informa o total sem completar as outras", async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.LOVABLE_API_KEY;
  process.env.LOVABLE_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    const file = body.messages[1].content.find(c => c.type === "file").file;
    assert.equal(file.filename, "teste-pagina-2.pdf");
    const bytes = Uint8Array.from(atob(file.file_data.split(",")[1]), c => c.charCodeAt(0));
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Texto da segunda página" }, finish_reason: "stop" }] }));
  };
  try {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 3; index++) pdf.addPage();
    const bytes = new Uint8Array(await pdf.save()).buffer;
    const result = await ocrPdfPage(bytes, 1, "teste");
    assert.equal(result.pageCount, 3);
    assert.equal(result.text, "Texto da segunda página");
    assert.equal(calls, 1);
    await assert.rejects(() => ocrPdfPage(bytes, 3, "teste"), /Página inválida/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LOVABLE_API_KEY; else process.env.LOVABLE_API_KEY = originalKey;
  }
});