/**
 * Geração dos entregáveis da conferência:
 *  - XLSX com a descrição conferida (layout de cartório);
 *  - PDF do relatório completo da análise.
 * Tudo executado no cliente, sem consumo de créditos de IA.
 */
import { utils, writeFile } from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { coordToDms, degToDms, fmtNum, fmtMedida, CLASSIFICACAO, SEVERIDADE, TIPO_COMPARACAO } from "./labels";
import { agruparConfrontantes } from "./confrontantes";
import type { TrechoConferido } from "./comparison-engine";

export type VertexCoordRow = {
  name: string;
  lon: number | null;
  lat: number | null;
  alt: number | null;
  north: number | null;
  east: number | null;
};

export type SegmentRow = {
  seq: number;
  from_vertex: string | null;
  to_vertex: string | null;
  azimuth_deg: number | string | null;
  distance_m: number | string | null;
  altitude_from_m: number | string | null;
  altitude_to_m: number | string | null;
  confrontante: string | null;
};

export type ParcelExport = {
  label: string | null;
  area_m2: number | string | null;
  declared_perimeter_m: number | string | null;
  computed_perimeter_m: number | string | null;
  vertex_count: number;
  segments: SegmentRow[];
  raw_extraction?: unknown;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};

/** Número em texto pt-BR, pronto para colar no sistema do cartório. */
const br = (v: number | string | null | undefined, d = 2): string => {
  const n = num(v);
  return n === null
    ? ""
    : n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
};

const grau = (v: number | string | null | undefined): string => {
  const n = num(v);
  return n === null ? "" : degToDms(n);
};

const vname = (v: string | null): string =>
  (v ?? "").trim().replace(/[.,;]+$/, "").toUpperCase();

export function getVertices(parcel: ParcelExport): VertexCoordRow[] {
  const raw = parcel.raw_extraction as { vertices?: VertexCoordRow[] } | null;
  return Array.isArray(raw?.vertices) ? raw!.vertices! : [];
}

/** Descrição SIGEF: vértices com coordenadas geodésicas (longitude/latitude). */
export function isSigefGeodesico(parcel: ParcelExport): boolean {
  return getVertices(parcel).some((v) => v.lat !== null && v.lon !== null);
}

function vertexIndex(parcel: ParcelExport): Map<string, VertexCoordRow> {
  const map = new Map<string, VertexCoordRow>();
  getVertices(parcel).forEach((v) => map.set(String(v.name).toUpperCase(), v));
  return map;
}

function altitudeDe(s: SegmentRow, v: VertexCoordRow | undefined): string {
  return fmtMedida(s.altitude_from_m ?? v?.alt ?? null);
}

export function buildDescricaoSheets(parcel: ParcelExport): {
  sigef: boolean;
  perimetro: (string | number)[][];
  confrontacao: (string | number)[][] | null;
} {
  const idx = vertexIndex(parcel);
  const segs = [...parcel.segments]
    .filter(
      (s) =>
        (s.from_vertex ?? "") !== "" ||
        (s.to_vertex ?? "") !== "" ||
        num(s.azimuth_deg) !== null,
    )
    .sort((a, b) => a.seq - b.seq);
  const sigef = isSigefGeodesico(parcel);

  if (sigef) {
    const perimetro: (string | number)[][] = [
      ["DE", "LONGITUDE", "LATITUDE", "ALT (m.)", "PARA", "ÂNGULO", "DIST. (m)."],
    ];
    const confrontacao: (string | number)[][] = [["DE", "PARA", "CONFRONTAÇÃO"]];
    segs.forEach((s) => {
      const v = idx.get(vname(s.from_vertex));
      perimetro.push([
        vname(s.from_vertex),
        v?.lon === null || v?.lon === undefined ? "" : coordToDms(v.lon, "lon"),
        v?.lat === null || v?.lat === undefined ? "" : coordToDms(v.lat, "lat"),
        altitudeDe(s, v),
        vname(s.to_vertex),
        grau(s.azimuth_deg),
        fmtMedida(s.distance_m),
      ]);
      confrontacao.push([
        vname(s.from_vertex),
        vname(s.to_vertex),
        s.confrontante ?? "",
      ]);
    });
    return { sigef, perimetro, confrontacao };
  }

  const perimetro: (string | number)[][] = [
    ["DE", "COORD. N(Y)", "COORD. E(X)", "ALT (m.)", "PARA", "ÂNGULO", "DIST. (m).", "CONFRONTAÇÃO"],
  ];
  segs.forEach((s) => {
    const v = idx.get(vname(s.from_vertex));
    perimetro.push([
      vname(s.from_vertex),
      v?.north === null || v?.north === undefined ? "" : br(v.north, 3),
      v?.east === null || v?.east === undefined ? "" : br(v.east, 3),
      altitudeDe(s, v),
      vname(s.to_vertex),
      grau(s.azimuth_deg),
      fmtMedida(s.distance_m),
      s.confrontante ?? "",
    ]);
  });
  return { sigef, perimetro, confrontacao: null };
}

function larguras(rows: (string | number)[][]): { wch: number }[] {
  const cols = rows[0]?.length ?? 0;
  return Array.from({ length: cols }, (_, c) => ({
    wch: Math.min(
      48,
      Math.max(10, ...rows.map((r) => String(r[c] ?? "").length + 2)),
    ),
  }));
}

export function exportarDescricaoXlsx(
  parcel: ParcelExport,
  nomeArquivo: string,
): { sigef: boolean; linhas: number } {
  const { sigef, perimetro, confrontacao } = buildDescricaoSheets(parcel);
  const wb = utils.book_new();

  const wsPerim = utils.aoa_to_sheet(perimetro);
  wsPerim["!cols"] = larguras(perimetro);
  utils.book_append_sheet(
    wb,
    wsPerim,
    sigef ? "Descrição perimétrica" : "Descrição",
  );

  if (confrontacao) {
    const wsConf = utils.aoa_to_sheet(confrontacao);
    wsConf["!cols"] = larguras(confrontacao);
    utils.book_append_sheet(wb, wsConf, "Confrontação");
  }

  const resumo: (string | number)[][] = [
    ["Elemento", "Valor"],
    ["Identificação", parcel.label ?? "—"],
    ["Área (m²)", fmtMedida(parcel.area_m2)],
    ["Perímetro declarado (m)", fmtMedida(parcel.declared_perimeter_m)],
    ["Perímetro calculado (m)", fmtMedida(parcel.computed_perimeter_m)],
    ["Vértices", parcel.vertex_count],
    ["Formato", sigef ? "Rural georreferenciado (SIGEF)" : "Coordenadas planas / descrição comum"],
    ["Emissão", new Date().toLocaleString("pt-BR")],
  ];
  const wsResumo = utils.aoa_to_sheet(resumo);
  wsResumo["!cols"] = larguras(resumo);
  utils.book_append_sheet(wb, wsResumo, "Resumo");

  writeFile(wb, nomeArquivo);
  return { sigef, linhas: perimetro.length - 1 };
}

// ---------------------------------------------------------------------------
// Relatório em PDF
// ---------------------------------------------------------------------------

export type RelatorioPdfInput = {
  titulo: string;
  tipo: string;
  classificacao: string | null;
  resumo: string | null;
  emitidoEm: string;
  documentoA: string;
  documentoB: string;
  tolerancias: Record<string, number | boolean | undefined>;
  contagens: Record<string, number | undefined>;
  trechos?: TrechoConferido[];
  extensaoConferidaM?: number | null;
  achados: {
    severity: string;
    code: string;
    title: string;
    description: string;
    evidence: unknown;
    situacao?: string;
    justificativa?: string;
  }[];

};

const ORDEM_SEV = ["critical", "moderate", "inconclusive", "informative"];

export function shrinkOnOverflow(doc: jsPDF, minSize = 5) {
  return (data: any) => {
    if (data.section !== "body") return;
    const text = String(data.cell.raw ?? "");
    if (!text) return;
    const baseSize = data.cell.styles.fontSize ?? 8;
    const pad = data.cell.styles.cellPadding;
    const padding = (typeof pad === "number" ? pad : Array.isArray(pad) ? pad[1] ?? pad[0] ?? 0 : 0) * 2;
    const maxWidth = data.cell.width - padding;
    if (maxWidth <= 0) return;
    doc.setFontSize(baseSize);
    const textWidth = doc.getTextWidth(text);
    if (textWidth <= maxWidth) return;
    const ratio = maxWidth / textWidth;
    data.cell.styles.fontSize = Math.max(minSize, baseSize * ratio);
  };
}

function withShrink(doc: jsPDF, handler?: (data: any) => void) {
  const shrink = shrinkOnOverflow(doc);
  return (data: any) => {
    shrink(data);
    handler?.(data);
  };
}




export function exportarRelatorioPdf(
  input: RelatorioPdfInput,
  nomeArquivo: string,
): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 48;
  const W = doc.internal.pageSize.getWidth();
  let y = M;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Relatório de conferência registral", M, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(input.titulo, M, y);
  y += 14;
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `${input.tipo} • Emitido em ${input.emitidoEm}`,
    M,
    y,
  );
  doc.setTextColor(0);
  y += 18;

  const cls = input.classificacao
    ? (CLASSIFICACAO[input.classificacao]?.label ?? input.classificacao)
    : "Inconclusivo";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Classificação: ${cls}`, M, y);
  doc.setFont("helvetica", "normal");
  y += 16;

  if (input.resumo) {
    doc.setFontSize(10);
    const linhas = doc.splitTextToSize(input.resumo, W - 2 * M) as string[];
    doc.text(linhas, M, y);
    y += linhas.length * 13 + 6;
  }

    autoTable(doc, {
    startY: y,
    head: [["Documentos comparados", ""]],
    body: [
      ["Documento A", input.documentoA],
      ["Documento B", input.documentoB],
    ],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [24, 28, 38], textColor: 255 },
    margin: { left: M, right: M },
    didParseCell: withShrink(doc),
  });

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16,
    head: [["Tolerância", "Valor adotado"]],
    body: [
      ["Área (percentual)", `${fmtNum(input.tolerancias["areaPct"] ?? null, 2)} %`],
      ["Área (medida)", `${fmtNum(input.tolerancias["areaM2"] ?? null, 2)} m²`],
      ["Perímetro (percentual)", `${fmtNum(input.tolerancias["perimeterPct"] ?? null, 2)} %`],
      ["Perímetro (medida)", `${fmtNum(input.tolerancias["perimeterM"] ?? null, 3)} m`],
      ["Distância", `${fmtNum(input.tolerancias["distanceM"] ?? null, 3)} m`],
      ["Azimute", `${fmtNum(input.tolerancias["azimuthDeg"] ?? null, 4)} °`],
      ["Altitude", `${fmtNum(input.tolerancias["altitudeM"] ?? null, 2)} m`],
    ],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [24, 28, 38], textColor: 255 },
    margin: { left: M, right: M },
    didParseCell: withShrink(doc),
  });

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16,
    head: [["Críticos", "Moderados", "Informativos", "Inconclusivos"]],
    body: [
      [
        String(input.contagens["critical"] ?? 0),
        String(input.contagens["moderate"] ?? 0),
        String(input.contagens["informative"] ?? 0),
        String(input.contagens["inconclusive"] ?? 0),
      ],
    ],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5, halign: "center" },
    headStyles: { fillColor: [24, 28, 38], textColor: 255, halign: "center" },
    margin: { left: M, right: M },
    didParseCell: withShrink(doc),
  });

  /**
   * Escreve o título de uma seção, abrindo nova página quando não há espaço
   * suficiente abaixo (evita título colado ao rodapé ou órfão).
   */
  const secao = (yBase: number, titulo: string, subtitulo: string): number => {
    const limite = doc.internal.pageSize.getHeight() - 120;
    let yS = yBase;
    if (yS > limite) {
      doc.addPage();
      yS = M;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(titulo, M, yS);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    const sub = doc.splitTextToSize(subtitulo, W - 2 * M) as string[];
    doc.text(sub, M, yS + 13);
    doc.setTextColor(0);
    return yS + 13 + sub.length * 11 + 8;
  };

  const trechos = input.trechos ?? [];
  if (trechos.length > 0) {
    const primeiro = trechos[0]!;
    const ultimo = trechos[trechos.length - 1]!;
    const extensao =
      input.extensaoConferidaM ??
      trechos.reduce((acc, t) => acc + (t.distancia_a ?? 0), 0);
    const yTabela = secao(
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24,
      "Conferência trecho a trecho",
      `Trecho total conferido: ${primeiro.de_a ?? "?"} a ${ultimo.ate_a ?? "?"} • ${trechos.length} trecho(s) • ${fmtMedida(extensao)} m • ${trechos.filter((t) => t.ok).length} conforme(s)${primeiro.invertido ? " • conferido por contra-azimute" : ""}`,
    );

    autoTable(doc, {
      startY: yTabela,
      head: [["#", "Trecho (A)", "Corresp. (B)", "Dist. A/B (m)", "Azimute A/B", "Cota A/B (m)", "Situação"]],
      body: trechos.map((t) => [
        String(t.seq_a),
        `${t.de_a ?? "?"} - ${t.ate_a ?? "?"}`,
        `${t.de_b ?? "?"} - ${t.ate_b ?? "?"}`,
        `${fmtMedida(t.distancia_a)} / ${fmtMedida(t.distancia_b)}`,
        `${degToDms(t.azimute_a)} / ${degToDms(t.azimute_b)}`,
        `${fmtMedida(t.cota_a)} / ${fmtMedida(t.cota_b)}`,
        t.ok ? "OK — correto" : `X — ${t.problemas.join("; ")}`,
      ]),
      theme: "grid",
      rowPageBreak: "avoid",
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: [24, 28, 38], textColor: 255, valign: "middle" },
      columnStyles: {
        0: { cellWidth: 20, halign: "right" },
        1: { cellWidth: 68 },
        2: { cellWidth: 68 },
        3: { cellWidth: 76, halign: "right" },
        4: { cellWidth: 84, halign: "right" },
        5: { cellWidth: 66, halign: "right" },
        6: { cellWidth: "auto" },
      },
      didParseCell: withShrink(doc, (data) => {
        if (data.section === "body" && data.column.index === 6) {
          const ok = trechos[data.row.index]?.ok;
          data.cell.styles.textColor = ok ? [22, 101, 52] : [153, 27, 27];
          data.cell.styles.fontStyle = "bold";
        }
      }),
      margin: { left: M, right: M },
    });


    const confrontacoes = input.tolerancias["ignoreConfrontations"] ? [] : agruparConfrontantes(trechos);
    if (confrontacoes.length > 0) {
      const yConfTabela = secao(
        (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24,
        "Imóveis confrontantes",
        "Caminhamento resumido por confrontação: do vértice inicial ao final de cada divisa comum.",
      );

      autoTable(doc, {
        startY: yConfTabela,
        head: [["Confrontação", "Caminhamento", "Trechos", "Extensão (m)", "Situação"]],
        body: confrontacoes.map((g) => [
          g.confrontante,
          `${g.de} a ${g.ate}`,
          String(g.trechos),
          fmtMedida(g.extensao_m),
          g.ok ? "OK — correto" : `X — ${g.problemas.join("; ")}`,
        ]),
        theme: "grid",
        rowPageBreak: "avoid",
        styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", valign: "top" },
        headStyles: { fillColor: [24, 28, 38], textColor: 255, valign: "middle" },
        columnStyles: {
          0: { cellWidth: "auto" },
          1: { cellWidth: 96 },
          2: { cellWidth: 42, halign: "right" },
          3: { cellWidth: 66, halign: "right" },
          4: { cellWidth: 130 },
        },
        didParseCell: withShrink(doc, (data) => {
          if (data.section === "body" && data.column.index === 4) {
            const ok = confrontacoes[data.row.index]?.ok;
            data.cell.styles.textColor = ok ? [22, 101, 52] : [153, 27, 27];
            data.cell.styles.fontStyle = "bold";
          }
        }),
        margin: { left: M, right: M },
      });
    }
  }



  const achados = [...input.achados].sort(
    (a, b) => ORDEM_SEV.indexOf(a.severity) - ORDEM_SEV.indexOf(b.severity),
  );

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24,
    head: [["Severidade", "Código", "Achado", "Descrição", "Validação humana"]],
    body:
      achados.length > 0
        ? achados.map((f) => {
            const validacao =
              f.severity === "informative"
                ? "Trecho compatível."
                : [f.situacao ?? "Aguardando validação", f.justificativa]
                    .filter(Boolean)
                    .join(" — ");
            return [
              SEVERIDADE[f.severity]?.label ?? f.severity,
              f.code,
              f.title,
              f.description,
              validacao,
            ];
          })
        : [["—", "—", "Nenhum achado registrado", "", ""]],
    theme: "striped",
    rowPageBreak: "avoid",
    styles: { fontSize: 8.5, cellPadding: 5, valign: "top", overflow: "linebreak" },
    headStyles: { fillColor: [24, 28, 38], textColor: 255, valign: "middle" },
    columnStyles: {
      0: { cellWidth: 56 },
      1: { cellWidth: 104, fontSize: 7.5 },
      2: { cellWidth: 92 },
      3: { cellWidth: "auto" },
      4: { cellWidth: 100 },
    },
    didParseCell: withShrink(doc),
    margin: { left: M, right: M },
  });


  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20,
    head: [["Evidências técnicas registradas"]],
    body:
      achados.length > 0
        ? achados.map((f) => [
            `${f.code}: ${JSON.stringify(f.evidence)}`.slice(0, 1200),
          ])
        : [["Sem evidências associadas."]],
    theme: "plain",
    styles: { fontSize: 7.5, cellPadding: 4, overflow: "linebreak", textColor: 90 },
    headStyles: { fontStyle: "bold", textColor: 30 },
    didParseCell: withShrink(doc),
    margin: { left: M, right: M },
  });

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(
      "Instrumento de apoio à decisão. Não substitui a qualificação jurídica e técnica do Oficial.",
      M,
      doc.internal.pageSize.getHeight() - 24,
    );
    doc.text(
      `${p}/${total}`,
      W - M,
      doc.internal.pageSize.getHeight() - 24,
      { align: "right" },
    );
  }

  doc.save(nomeArquivo);
}

export { TIPO_COMPARACAO };
