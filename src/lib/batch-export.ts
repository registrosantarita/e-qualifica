import { strToU8, zipSync } from "fflate";
import { montarMatriculaXlsx } from "./export-matricula";
import { montarRelatorioPdf, type ParcelExport, type RelatorioPdfInput } from "./export-registral";
import { montarDwg, montarKml, montarKmz } from "./export-geometria";

export type BatchFormat = "xlsx" | "dwg" | "kml" | "kmz";
export type ExportItem = { id: string; name: string; parcel: ParcelExport };
export const archiveName = (format: BatchFormat) => `${format.toUpperCase()}.ZIP`;
export const safeName = (name: string) => name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 70) || "documento";

export async function createDocumentArchive(items: ExportItem[], format: BatchFormat, onProgress?: (current: number, total: number) => void) {
  if (!items.length) throw new Error("Nenhum polígono disponível nos documentos selecionados.");
  const files: Record<string, Uint8Array> = {};
  const failures: string[] = [];
  for (const [i, item] of items.entries()) {
    onProgress?.(i + 1, items.length);
    try {
      const data = format === "xlsx" ? (await montarMatriculaXlsx(item.parcel)).bytes : format === "dwg" ? (await montarDwg(item.parcel)).bytes : format === "kmz" ? montarKmz(item.parcel) : strToU8(montarKml(item.parcel));
      files[`${safeName(item.name)}-${item.id}.${format}`] = data;
    } catch (e) { failures.push(`${item.name}: ${e instanceof Error ? e.message : "Falha na exportação"}`); }
  }
  const count = Object.keys(files).length;
  if (!count) throw new Error(failures.join("\n"));
  if (failures.length) files["FALHAS.txt"] = strToU8(failures.join("\n"));
  return { bytes: zipSync(files), name: archiveName(format), count, failures };
}

export async function createReportDownload(inputs: { id: string; input: RelatorioPdfInput }[], mode: "individual" | "combined") {
  if (!inputs.length) throw new Error("Selecione ao menos uma comparação.");
  const files = inputs.map(({ id, input }) => ({ name: `relatorio-${safeName(input.tipo)}-${id}.pdf`, bytes: new Uint8Array(montarRelatorioPdf(input).output("arraybuffer")) }));
  if (mode === "individual") return { bytes: zipSync(Object.fromEntries(files.map(f => [f.name, f.bytes]))), name: "RELATORIOS.ZIP", mime: "application/zip" };
  const { PDFDocument } = await import("pdf-lib");
  const combined = await PDFDocument.create();
  for (const f of files) {
    const source = await PDFDocument.load(f.bytes);
    for (const page of await combined.copyPages(source, source.getPageIndices())) combined.addPage(page);
  }
  return { bytes: await combined.save(), name: "RELATORIO-COMPARACOES.pdf", mime: "application/pdf" };
}