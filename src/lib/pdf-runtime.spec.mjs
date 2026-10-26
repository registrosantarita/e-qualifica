import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("bundled ESM PDF reader splits a three-page scanned memorial without tslib default interop", async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../../", import.meta.url)),
    appType: "custom",
    server: { middlewareMode: true },
    resolve: { alias: [{ find: /^pdf-lib$/, replacement: fileURLToPath(new URL("../../node_modules/pdf-lib/dist/pdf-lib.esm.js", import.meta.url)) }] },
  });
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.LOVABLE_API_KEY;
  const requests = [];
  try {
    const { PDFDocument } = await server.ssrLoadModule("pdf-lib");
    const { ocrDocument } = await server.ssrLoadModule("/src/lib/ocr.server.ts");
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 3; i++) pdf.addPage();
    process.env.LOVABLE_API_KEY = "test-key";
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      const file = body.messages[1].content.find((item) => item.type === "file").file;
      const bytes = Uint8Array.from(atob(file.file_data.split(",")[1]), (c) => c.charCodeAt(0));
      assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
      requests.push(file.filename);
      return new Response(JSON.stringify({ choices: [{ message: { content: `Texto conferido da página ${requests.length}` }, finish_reason: "stop" }] }));
    };
    const result = await ocrDocument(new Uint8Array(await pdf.save()).buffer, "pdf", "memorial", { geoconfronto: true });
    assert.deepEqual(requests, ["memorial-pagina-1.pdf", "memorial-pagina-2.pdf", "memorial-pagina-3.pdf"]);
    assert.equal(result.text, "Texto conferido da página 1\nTexto conferido da página 2\nTexto conferido da página 3");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LOVABLE_API_KEY;
    else process.env.LOVABLE_API_KEY = originalKey;
    await server.close();
  }
});