import { test } from "node:test";
import assert from "node:assert/strict";
import { stripInvisiblePdfText, removeHiddenOcrLayer } from "./pdf-ocr-visual.server.ts";
import { PDFDocument, PDFName, decodePDFRawStream } from "pdf-lib";

test("invisible OCR is removed without removing printed coordinates or image transforms", () => {
  const source = 'q 602 0 0 888 0 0 cm /Scan Do Q\nBT /F1 10 Tf 3 Tr (wrong coordinate) Tj ET\nBT 0 Tr (-47°35\'21,991) Tj ET';
  const result = stripInvisiblePdfText(source);
  assert.equal(result.includes('wrong coordinate'), false);
  assert.ok(result.includes("-47°35'21,991"));
  assert.ok(result.includes('602 0 0 888 0 0 cm /Scan Do'));
});
test("operators inside strings/comments cannot erase visible text", () => {
  const source = '% BT 3 Tr fake ET\nBT (BT 3 Tr nested \\( ET) Tj ET\nBT <42542033205472> Tj ET';
  assert.equal(stripInvisiblePdfText(source), source);
});
test("mixed visible/invisible text and implicit rendering modes remain untouched", () => {
  const source = 'BT 3 Tr (hidden) Tj 0 Tr (visible) Tj ET\nBT (native) Tj ET';
  assert.equal(stripInvisiblePdfText(source), source);
});
test("compressed PDF content is cleaned on a copy and retains the full page image", async () => {
  const pdf = await PDFDocument.create(), page = pdf.addPage([602.64, 888.48]);
  const source = 'q 602 0 0 888 0 0 cm /Scan Do Q\nBT 3 Tr (broken hidden OCR) Tj ET';
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(source)));
  await removeHiddenOcrLayer(pdf, page);
  const clean = decodePDFRawStream(page.node.Contents()).decode();
  assert.equal(new TextDecoder().decode(clean).includes('broken hidden OCR'), false);
  assert.ok(new TextDecoder().decode(clean).includes('/Scan Do'));
  assert.equal(page.getWidth(), 602.64);
  assert.equal(page.getHeight(), 888.48);
});