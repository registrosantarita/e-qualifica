/** Extração textual server-side (PDF e texto simples). */

export async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js "detacha" (invalida) o buffer recebido; sempre trabalhar numa cópia.
  const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
  const { text } = await extractText(pdf, { mergePages: false });
  return removeRepeatedPdfPageHeaders(Array.isArray(text) ? text : [text]).join("\n");
}

/** Remove cabeçalhos repetidos que, na junção de páginas, partem uma medida ou um vértice. */
export function removeRepeatedPdfPageHeaders(pages: string[]): string[] {
  if (pages.length < 2) return pages;
  const lines = pages.map((page) => page.split("\n"));
  // Apenas um prefixo idêntico em todas as páginas seguido de uma indicação de página
  // é considerado cabeçalho. Assim não descartamos uma descrição no início de página.
  let prefix = 0;
  while (
    prefix < 5 &&
    lines.every((page) => page[prefix]?.trim() === lines[0]?.[prefix]?.trim() && Boolean(page[prefix]?.trim()))
  ) prefix++;
  if (prefix === 0 || !lines.every((page) => /^p[áa]gina\s+\d+\s+de\s+\d+\s*$/i.test(page[prefix]?.trim() ?? ""))) {
    return pages;
  }
  return lines.map((page) => page.slice(prefix + 1).join("\n"));
}

export function decodeText(bytes: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

const TEXT_EXTENSIONS = ["txt", "csv", "md", "json", "xml", "kml", "geojson"];

const OCR_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "tif", "tiff"];

/** KMZ: pacote compactado contendo um ou mais arquivos KML. */
export async function extractKmzText(bytes: ArrayBuffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(bytes));
  const name = Object.keys(files).find((f) => f.toLowerCase().endsWith(".kml"));
  return name ? strFromU8(files[name]!) : "";
}

/** DOCX: descompacta o pacote OOXML e extrai o texto dos parágrafos. */
export async function extractDocxText(bytes: ArrayBuffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(bytes));
  const parts = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"];
  const chunks: string[] = [];
  for (const part of parts) {
    const raw = files[part];
    if (!raw) continue;
    const xml = strFromU8(raw);
    const text = xml
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
    chunks.push(text.trim());
  }
  return chunks.filter(Boolean).join("\n\n");
}

/** XLSX/XLS: converte cada planilha em texto tabular legível pelo parser. */
export async function extractSpreadsheetText(bytes: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
  const chunks: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ";", blankrows: false });
    if (csv.trim()) chunks.push(`# Planilha: ${name}\n${csv.trim()}`);
  }
  return chunks.join("\n\n");
}

export async function extractTextFromFile(
  bytes: ArrayBuffer,
  extension: string,
): Promise<{
  text: string;
  note?: string;
  usage?: import("./ocr.server").OcrUsage;
}> {
  const ext = extension.toLowerCase().replace(".", "");
  if (ext === "pdf") {
    const text = await extractPdfText(bytes);
    if (text.trim().length < 40) {
      const { ocrDocument } = await import("./ocr.server");
      const ocr = await ocrDocument(bytes.slice(0), "pdf");
      if (ocr.text.trim()) return ocr;
      return {
        text,
        ...(ocr.usage ? { usage: ocr.usage } : {}),
        note:
          ocr.note ??
          "O PDF parece ser digitalizado (sem camada de texto) e o OCR não retornou conteúdo. Cole o texto do memorial manualmente.",
      };
    }
    return { text };
  }
  if (OCR_IMAGE_EXTENSIONS.includes(ext)) {
    const { ocrDocument } = await import("./ocr.server");
    return await ocrDocument(bytes.slice(0), ext);
  }
  if (ext === "kmz") {
    const text = await extractKmzText(bytes);
    if (!text.trim()) {
      return { text: "", note: "Não foi possível localizar um KML dentro do arquivo KMZ." };
    }
    return { text };
  }
  if (ext === "docx") {
    const text = await extractDocxText(bytes);
    if (text.trim().length < 20) {
      return {
        text,
        note: "Não foi possível localizar texto no DOCX. Cole o conteúdo manualmente para extrair os dados técnicos.",
      };
    }
    return { text };
  }
  if (ext === "xlsx" || ext === "xlsm" || ext === "xls") {
    const text = await extractSpreadsheetText(bytes);
    if (text.trim().length < 20) {
      return {
        text,
        note: "A planilha não apresentou conteúdo textual legível. Cole os dados manualmente para extrair as informações técnicas.",
      };
    }
    return { text };
  }
  if (TEXT_EXTENSIONS.includes(ext)) {
    return { text: decodeText(bytes) };
  }
  if (ext === "dxf") {
    const { parseDxf, isDxfText } = await import("./dxf-reader");
    const { cadParaMemorial } = await import("./cad-to-memorial");
    const raw = decodeText(bytes);
    if (isDxfText(raw)) {
      const conv = cadParaMemorial(parseDxf(raw), "desenho.dxf");
      if (conv.text.trim()) {
        return { text: conv.text, ...(conv.aviso ? { note: conv.aviso } : {}) };
      }
      return { text: "", note: conv.aviso ?? "Nenhuma polilinha fechada no DXF." };
    }
    return {
      text: "",
      note: "DXF binário não suportado: salve como DXF ASCII ou envie o DWG original.",
    };
  }
  if (ext === "dwg") {
    return {
      text: "",
      note: "A geometria do DWG é lida no navegador no momento do envio. Reenvie o arquivo pela tela de upload para reprocessar o desenho.",
    };
  }
  return {
    text: "",
    note: `Leitura automática de arquivos .${ext} ainda não está no escopo do MVP. O arquivo foi arquivado com rastreabilidade; cole o texto correspondente para extrair os dados técnicos.`,
  };
}
