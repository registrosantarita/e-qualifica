/**
 * Geração do XLSX "Descrição para Matrícula".
 * Layout de cartório, fonte Montserrat 9, cabeçalhos em negrito e maiúsculas.
 *  - Urbanos / rurais sem georreferenciamento: tabela única (coordenadas planas).
 *  - Rurais com georreferenciamento certificado: tabela perimétrica (vértice a
 *    vértice) + tabela de confrontação (agrupada por confrontante).
 */
import ExcelJS from "exceljs";
import { coordToDms, degToDms } from "./labels";
import { getVertices, isSigefGeodesico, type ParcelExport, type SegmentRow, type VertexCoordRow } from "./export-registral";

const FONTE = { name: "Montserrat", size: 9 } as const;
const FMT2 = "#,##0.00";
const FMT3 = "#,##0.000";

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};

const vname = (v: string | null | undefined): string =>
  (v ?? "").trim().replace(/[.,;]+$/, "").toUpperCase();

const chaveConfrontante = (s: string | null | undefined): string =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function segmentosOrdenados(parcel: ParcelExport): SegmentRow[] {
  return [...parcel.segments]
    .filter(
      (s) =>
        (s.from_vertex ?? "") !== "" ||
        (s.to_vertex ?? "") !== "" ||
        num(s.azimuth_deg) !== null,
    )
    .sort((a, b) => a.seq - b.seq);
}

function indiceVertices(parcel: ParcelExport): Map<string, VertexCoordRow> {
  const map = new Map<string, VertexCoordRow>();
  getVertices(parcel).forEach((v) => map.set(String(v.name).toUpperCase(), v));
  return map;
}

/** Agrupa trechos consecutivos com o mesmo confrontante: só o 1º e o último vértice. */
export function agruparConfrontacao(
  segs: SegmentRow[],
): { de: string; para: string; confrontacao: string }[] {
  const out: { de: string; para: string; confrontacao: string }[] = [];
  let atual: { de: string; para: string; confrontacao: string; chave: string } | null = null;
  for (const s of segs) {
    const conf = (s.confrontante ?? "").trim();
    const chave = chaveConfrontante(conf);
    if (atual && atual.chave === chave) {
      atual.para = vname(s.to_vertex);
      continue;
    }
    if (atual) out.push({ de: atual.de, para: atual.para, confrontacao: atual.confrontacao });
    atual = {
      de: vname(s.from_vertex),
      para: vname(s.to_vertex),
      confrontacao: conf,
      chave,
    };
  }
  if (atual) out.push({ de: atual.de, para: atual.para, confrontacao: atual.confrontacao });
  return out;
}

type Coluna = { titulo: string; largura: number; fmt?: string; alinhar?: "right" | "left" };

/** Formato numérico com as casas decimais efetivamente presentes (mín. 2). */
function fmtDinamico(valores: (string | number | null)[][], col: number): string {
  let casas = 2;
  for (const linha of valores) {
    const v = linha[col];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const s = String(Number(v.toFixed(8)));
    const i = s.indexOf(".");
    if (i >= 0) casas = Math.max(casas, s.length - i - 1);
  }
  return `#,##0.${"0".repeat(Math.min(casas, 8))}`;
}

function montarTabela(
  ws: ExcelJS.Worksheet,
  colunas: Coluna[],
  linhas: (string | number | null)[][],
  linhaInicial: number,
  colunaInicial = 1,
): number {
  const formatos = colunas.map((c, i) => (c.fmt ? fmtDinamico(linhas, i) : undefined));
  const head = ws.getRow(linhaInicial);
  colunas.forEach((c, i) => {
    const cell = head.getCell(colunaInicial + i);
    cell.value = c.titulo.toUpperCase();
    cell.font = { ...FONTE, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  head.commit?.();

  linhas.forEach((linha, r) => {
    const row = ws.getRow(linhaInicial + 1 + r);
    colunas.forEach((c, i) => {
      const cell = row.getCell(colunaInicial + i);
      const v = linha[i];
      cell.value = v === null || v === undefined ? "" : v;
      cell.font = { ...FONTE, bold: false };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      if (formatos[i] && typeof v === "number") cell.numFmt = formatos[i] as string;
    });
    row.commit?.();
  });


  colunas.forEach((c, i) => {
    const col = ws.getColumn(colunaInicial + i);
    col.width = Math.max(col.width ?? 0, c.largura);
  });

  return linhaInicial + linhas.length + 1;
}


export type MatriculaResultado = {
  sigef: boolean;
  linhas: number;
  confrontacoes: number;
};

export async function exportarMatriculaXlsx(
  parcel: ParcelExport,
  nomeArquivo: string,
): Promise<MatriculaResultado> {
  const segs = segmentosOrdenados(parcel);
  const idx = indiceVertices(parcel);
  const sigef = isSigefGeodesico(parcel);

  const wb = new ExcelJS.Workbook();
  wb.creator = "e-Qualifica";
  wb.created = new Date();

  let confrontacoes = 0;

  if (sigef) {
    const ws = wb.addWorksheet("Descrição para Matrícula");
    const perim = segs.map((s) => {
      const v = idx.get(vname(s.from_vertex));
      return [
        vname(s.from_vertex),
        vname(s.to_vertex),
        coordToDms(v?.lon ?? null, "lon", v?.lon_raw),
        coordToDms(v?.lat ?? null, "lat", v?.lat_raw),
        num(s.altitude_from_m) ?? v?.alt ?? null,
        degToDms(num(s.azimuth_deg)),
        num(s.distance_m),
      ];
    });
    const prox = montarTabela(
      ws,
      [
        { titulo: "DE", largura: 14 },
        { titulo: "PARA", largura: 14 },
        { titulo: "LONGITUDE", largura: 20, alinhar: "right" },
        { titulo: "LATITUDE", largura: 20, alinhar: "right" },
        { titulo: "ALT. (m)", largura: 12, fmt: FMT2, alinhar: "right" },
        { titulo: "ÂNGULO", largura: 16, alinhar: "right" },
        { titulo: "DIST. (m)", largura: 14, fmt: FMT2, alinhar: "right" },
      ],
      perim,
      1,
    );
    void prox;

    const grupos = agruparConfrontacao(segs);
    confrontacoes = grupos.length;
    // Tabela de confrontação ao lado direito, pulando uma coluna (col. 9).
    montarTabela(
      ws,
      [
        { titulo: "DE", largura: 14 },
        { titulo: "PARA", largura: 14 },
        { titulo: "CONFRONTAÇÃO", largura: 60 },
      ],
      grupos.map((g) => [g.de, g.para, g.confrontacao]),
      1,
      9,
    );


    await baixar(wb, nomeArquivo);
    return { sigef, linhas: perim.length, confrontacoes };
  }

  const ws = wb.addWorksheet("Descrição para Matrícula");
  const linhas = segs.map((s) => {
    const v = idx.get(vname(s.from_vertex));
    return [
      vname(s.from_vertex),
      vname(s.to_vertex),
      v?.north ?? null,
      v?.east ?? null,
      degToDms(num(s.azimuth_deg)),
      num(s.distance_m),
      s.confrontante ?? "",
    ];
  });
  montarTabela(
    ws,
    [
      { titulo: "DE", largura: 14 },
      { titulo: "PARA", largura: 14 },
      { titulo: "COORD. N(Y)", largura: 18, fmt: FMT3, alinhar: "right" },
      { titulo: "COORD. E(X)", largura: 18, fmt: FMT3, alinhar: "right" },
      { titulo: "ÂNGULO", largura: 16, alinhar: "right" },
      { titulo: "DIST. (m)", largura: 14, fmt: FMT2, alinhar: "right" },
      { titulo: "CONFRONTAÇÃO", largura: 60 },
    ],
    linhas,
    1,
  );

  await baixar(wb, nomeArquivo);
  return { sigef, linhas: linhas.length, confrontacoes };
}

async function baixar(wb: ExcelJS.Workbook, nomeArquivo: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
