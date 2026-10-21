import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMemorial } from "./memorial-parser.ts";
import { parseParcelas } from "./multi-parcel.ts";
import { needsGeoconfrontoOcr } from "./geoconfronto-text-quality.ts";
import { ocrDocument } from "./ocr.server.ts";
import { PDFDocument } from "pdf-lib";

const sigef = readFileSync(new URL("./fixtures/santa-rita-sigef.txt", import.meta.url), "utf8");
const prose = readFileSync(new URL("./fixtures/santa-rita-prosa.txt", import.meta.url), "utf8");

test("SIGEF Santa Rita preserva todos os 109 pares de coordenadas e o fechamento", () => {
  const p = parseParcelas(sigef, false);
  assert.equal(p.length, 1);
  assert.equal(p[0].segments.length, 109);
  assert.equal(p[0].vertices.length, 109);
  assert.ok(p[0].vertices.every(v => v.lon !== null && v.lat !== null && v.lon_raw && v.lat_raw));
  assert.equal(p[0].vertices[0].lon_raw, `-47°20'51,203"`);
  assert.equal(p[0].segments.at(-1).to_vertex, "SWTM-P-2324");
  assert.equal(needsGeoconfrontoOcr(sigef), false);
});

test("SIGEF com linha quebrada ou coordenada ilegível exige releitura", () => {
  assert.equal(needsGeoconfrontoOcr(sigef.replace(`-21°45'04,004"`, "[ilegível]")), true);
  assert.equal(needsGeoconfrontoOcr(sigef.replace(`711,88 SWTM-P-2325`, `711,88\nSWTM-P-2325`)), true);
});

test("títulos repetidos de página não dividem um único caminhamento", () => {
  const repeated = prose.replace("314°45'", "\nMEMORIAL DESCRITIVO\n314°45'");
  const p = parseParcelas(repeated, false);
  assert.equal(p.length, 1);
  assert.equal(p[0].segments.length, 109);
  assert.equal(p[0].vertices.length, 109);
});

test("coluna vazia fica pendente sem deslocar latitude para longitude", () => {
  const p = parseMemorial(`VERTICE;VANTE;LONGITUDE;LATITUDE;ALTITUDE;AZIMUTE;DISTANCIA\nV1;V2;;-21.1;700;90°00';10\nV2;V3;-47.1;-21.2;701;180°00';10\nV3;V1;-47.2;-21.3;702;270°00';10`);
  assert.equal(p.vertices[0].lon, null);
  assert.equal(p.vertices[0].lat, -21.1);
});

test("planta mantém somente 109 linhas completas e sinaliza códigos incoerentes sem substituição", () => {
  const text = readFileSync(new URL("./fixtures/santa-rita-planta.txt", import.meta.url), "utf8");
  const parcels = parseParcelas(text, false);
  assert.equal(parcels.length, 1);
  assert.equal(parcels[0].segments.length, 109);
  assert.equal(parcels[0].vertices.length, 109);
  assert.ok(parcels[0].vertices.every(v => v.lon !== null && v.lat !== null));
  assert.ok(parcels[0].warnings.some(w => w.includes("SWTM-P-2245") && w.includes("Sequência divergente")));
  assert.equal(parcels[0].segments[2].to_vertex, "SWTM-P-2245");
});

test("OCR de múltiplas páginas processa cada página e recusa resultado parcial", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
  const bytes = new Uint8Array(await pdf.save()).buffer;
  const originalFetch = globalThis.fetch, originalKey = process.env.LOVABLE_API_KEY;
  process.env.LOVABLE_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async (_url, request) => {
    calls++;
    const body = JSON.parse(request.body);
    const data = body.messages[1].content[1].file.file_data.split(",")[1];
    assert.equal((await PDFDocument.load(Buffer.from(data, "base64"))).getPageCount(), 1);
    return new Response(JSON.stringify({ choices: [{ message: { content: calls === 1 ? "vértice CTI-P-" : "23486, Longitude" }, finish_reason: "stop" }] }));
  };
  try {
    const result = await ocrDocument(bytes, "pdf", "teste", { geoconfronto: true });
    assert.equal(calls, 2);
    assert.equal(result.text, "vértice CTI-P-23486, Longitude");
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({choices:[{message:{content:"parcial"},finish_reason:"length"}]})); };
    assert.equal((await ocrDocument(bytes, "pdf", "teste", { geoconfronto: true })).text, "");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LOVABLE_API_KEY; else process.env.LOVABLE_API_KEY = originalKey;
  }
});