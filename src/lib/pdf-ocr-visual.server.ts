/** Remove only explicitly invisible text objects; never remove visible native text. */
export function stripInvisiblePdfText(source: string): string {
  // Literal/hex strings and comments are single tokens: their contents must not
  // be mistaken for PDF operators (including nested and escaped parentheses).
  const tokens: { value: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i] ?? "")) { i++; continue; }
    const start = i;
    if (source[i] === "%") {
      while (i < source.length && !/[\r\n]/.test(source[i] ?? "")) i++;
      continue;
    }
    if (source[i] === "(") {
      i++;
      let depth = 1;
      while (i < source.length && depth) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "(") depth++;
        if (source[i] === ")") depth--;
        i++;
      }
    } else if (source[i] === "<" && source[i + 1] !== "<") {
      i++;
      while (i < source.length && source[i] !== ">") i++;
      i++;
    } else if (/[\[\]<>/]/.test(source[i] ?? "")) {
      i++;
    } else {
      while (i < source.length && !/[\s()[\]<>/%]/.test(source[i] ?? "")) i++;
    }
    tokens.push({ value: source.slice(start, i), start, end: i });
  }
  const removals: { start: number; end: number }[] = [];
  let begin: number | undefined;
  let invisible = false, visible = false, shown = false;
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    if (!token) continue;
    if (token.value === "BT") { begin = token.start; invisible = false; visible = false; shown = false; }
    else if (begin !== undefined && token.value === "Tr") {
      const mode = tokens[t - 1]?.value;
      if (mode === "3" && !shown) invisible = true;
      else if (mode !== "3") visible = true;
    } else if (begin !== undefined && ["Tj", "TJ", "'", '"'].includes(token.value)) {
      if (!invisible) visible = true;
      shown = true;
    } else if (token.value === "ET" && begin !== undefined) {
      if (invisible && !visible) removals.push({ start: begin, end: token.end });
      begin = undefined;
    }
  }
  for (const range of removals.reverse()) source = source.slice(0, range.start) + " " + source.slice(range.end);
  return source;
}

/** Preserve page geometry/images (CCITT, layered filters, rotation) without stale hidden OCR. */
export async function removeHiddenOcrLayer(pdf: import("pdf-lib").PDFDocument, page: import("pdf-lib").PDFPage): Promise<void> {
  const { PDFArray, PDFRawStream, PDFName, decodePDFRawStream } = await import("pdf-lib");
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray
    ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
  if (!streams.length || streams.some(stream => !(stream instanceof PDFRawStream))) return;
  const chunks: string[] = [];
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) return;
    const bytes = decodePDFRawStream(stream).decode();
    let text = "";
    for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    chunks.push(text);
  }
  const source = chunks.join("\n"), clean = stripInvisiblePdfText(source);
  if (clean === source) return;
  const bytes = Uint8Array.from(clean, char => char.charCodeAt(0));
  page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(bytes)));
}