import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import { archiveName, createDocumentArchive, createReportDownload } from "./batch-export.ts";

const parcel = { label: "Gleba", area_m2: 100, declared_perimeter_m: 40, computed_perimeter_m: 40, vertex_count: 3, raw_extraction: { vertices: [{ name: "V1", lon: -47.123456, lat: -21.123456, lon_raw: "-47.123456000", lat_raw: "-21.123456000", alt: 700, north: null, east: null }, { name: "V2", lon: -47.12, lat: -21.12, alt: 700, north: null, east: null }, { name: "V3", lon: -47.13, lat: -21.12, alt: 700, north: null, east: null }] }, segments: [1,2,3].map((n,i) => ({ seq:n, from_vertex:`V${n}`, to_vertex:`V${n%3+1}`, distance_m:10, azimuth_deg:i*90, altitude_from_m:700, altitude_to_m:700, confrontante:"Vizinho" })) };
const items = [{ id:"a", name:"Memorial.pdf", parcel }, { id:"b", name:"Memorial.pdf", parcel }];
test("cada formato usa o nome do comando seguido de ZIP", () => {
  assert.equal(archiveName("dwg"), "DWG.ZIP"); assert.equal(archiveName("xlsx"), "XLSX.ZIP"); assert.equal(archiveName("kml"), "KML.ZIP"); assert.equal(archiveName("kmz"), "KMZ.ZIP");
});
test("documentos com nomes iguais permanecem separados no KML.ZIP", async () => {
  const r = await createDocumentArchive(items,"kml"); const files = unzipSync(r.bytes);
  assert.equal(r.count,2); assert.deepEqual(Object.keys(files),["Memorial-a.kml","Memorial-b.kml"]);
  assert.match(strFromU8(files["Memorial-a.kml"]), /-47.123456,-21.123456/);
});
test("KMZ individuais são arquivos válidos dentro do ZIP", async () => {
  const r = await createDocumentArchive(items,"kmz");
  const files = unzipSync(r.bytes); assert.equal(Object.keys(files).length,2);
  assert.ok(unzipSync(files["Memorial-a.kmz"])["doc.kml"]);
});
test("DWG.ZIP contém desenhos DWG separados com assinatura válida", async () => {
  const r = await createDocumentArchive(items,"dwg");
  const files = unzipSync(r.bytes); assert.equal(r.count,2);
  assert.deepEqual(Object.keys(files),["Memorial-a.dwg","Memorial-b.dwg"]);
  for (const bytes of Object.values(files)) assert.match(strFromU8(bytes.slice(0,6)),/^AC10/);
});
test("XLSX de matrícula mantém um arquivo por documento e os dados originais", async () => {
  const r = await createDocumentArchive(items,"xlsx"); const files = unzipSync(r.bytes);
  assert.equal(Object.keys(files).length,2);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(files["Memorial-a.xlsx"]);
  assert.equal(wb.getWorksheet(1).getCell("A2").value,"V1");
  assert.equal(wb.getWorksheet(1).getCell("G2").value,10);
});
test("falha de geometria não inventa arquivo e é registrada dentro do ZIP", async () => {
  const invalid = structuredClone(parcel); invalid.raw_extraction.vertices[0].lon=null;
  const r = await createDocumentArchive([...items,{id:"bad",name:"Falha.pdf",parcel:invalid}],"kml");
  assert.equal(r.count,2); assert.equal(r.failures.length,1);
  assert.match(strFromU8(unzipSync(r.bytes)["FALHAS.txt"]),/Falha.pdf/);
});
const report = { titulo:"Comparação",tipo:"Memorial x Planta",classificacao:"compatible",resumo:"Conferido",emitidoEm:"13/11/2026",documentoA:"A",documentoB:"B",tolerancias:{},contagens:{},achados:[] };
const reports = [{id:"a",input:report},{id:"b",input:{...report,titulo:"Segunda comparação"}}];
test("modo individual gera um PDF por comparação em RELATORIOS.ZIP", async () => {
  const r = await createReportDownload(reports,"individual"); const files = unzipSync(r.bytes);
  assert.equal(r.name,"RELATORIOS.ZIP"); assert.equal(Object.keys(files).length,2);
  for (const bytes of Object.values(files)) assert.ok((await PDFDocument.load(bytes)).getPageCount()>0);
});
test("PDF único reúne todas as páginas dos relatórios selecionados", async () => {
  const individual = unzipSync((await createReportDownload(reports,"individual")).bytes);
  let pages=0; for(const bytes of Object.values(individual)) pages+=(await PDFDocument.load(bytes)).getPageCount();
  const r = await createReportDownload(reports,"combined");
  assert.equal(r.name,"RELATORIO-COMPARACOES.pdf"); assert.equal((await PDFDocument.load(r.bytes)).getPageCount(),pages);
});