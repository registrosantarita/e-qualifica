/**
 * Motor de comparação técnica entre memoriais / divisas.
 * Cada achado é rastreável até a evidência de origem.
 */
import { normalizeName } from "./memorial-parser";
import { degToDms, fmtMedida, anguloComoModelo } from "./labels";

export type Severity = "critical" | "moderate" | "informative" | "inconclusive";
export type Classification =
  | "compatible"
  | "compatible_with_remarks"
  | "incompatible"
  | "inconclusive";

export type Tolerances = {
  areaPct: number;
  perimeterPct: number;
  distanceM: number;
  azimuthDeg: number;
  altitudeM: number;
  /** Tolerância absoluta de área, em metros quadrados. */
  areaM2: number;
  /** Tolerância absoluta de perímetro, em metros lineares. */
  perimeterM: number;
  /** Desconsidera nomes de confrontantes em achados e classificação. */
  ignoreConfrontations?: boolean;
};

export const DEFAULT_TOLERANCES: Tolerances = {
  areaPct: 0,
  perimeterPct: 0,
  distanceM: 0,
  azimuthDeg: 0,
  altitudeM: 0,
  areaM2: 0,
  perimeterM: 0,
  ignoreConfrontations: false,
};

/** Área/perímetro conferem quando ficam dentro do percentual OU da medida absoluta. */
const dentroDaTolerancia = (diff: number, pct: number, tolPct: number, tolAbs: number) =>
  pct <= tolPct || diff <= tolAbs;



export type SegmentInput = {
  seq: number;
  from_vertex: string | null;
  to_vertex: string | null;
  azimuth_deg: number | null;
  /** Ângulo exatamente como escrito no documento (ex.: "45°12'"). */
  bearing_text?: string | null;
  distance_m: number | null;
  altitude_from_m: number | null;
  altitude_to_m: number | null;
  confrontante: string | null;
};

export type ParcelInput = {
  label: string | null;
  area_m2: number | null;
  declared_perimeter_m: number | null;
  computed_perimeter_m: number | null;
  vertex_count: number;
  altitude_min_m: number | null;
  altitude_max_m: number | null;
  altitude_mean_m: number | null;
  confrontantes: string[];
  segments: SegmentInput[];
};

export type Finding = {
  severity: Severity;
  code: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
};

export type ComparisonResult = {
  classification: Classification;
  summary: string;
  metrics: Record<string, unknown>;
  findings: Finding[];
};

/** Linha da conferência trecho a trecho exibida no relatório e na tela. */
export type TrechoConferido = {
  seq_a: number;
  seq_b: number;
  de_a: string | null;
  ate_a: string | null;
  de_b: string | null;
  ate_b: string | null;
  distancia_a: number | null;
  distancia_b: number | null;
  azimute_a: number | null;
  azimute_b: number | null;
  /** Texto literal do ângulo no documento, quando disponível. */
  azimute_txt_a?: string | null;
  azimute_txt_b?: string | null;
  /** Cota (altitude) do vértice inicial do trecho, em metros. */
  cota_a: number | null;
  cota_b: number | null;
  invertido: boolean;
  ok: boolean;
  /** Falso quando não havia dado comum (distância/azimute) para conferir. */
  comparado?: boolean;
  problemas: string[];
  confrontante_a?: string | null;
  confrontante_b?: string | null;
};


function montarTrecho(
  seqA: number,
  seqB: number,
  sa: SegmentInput,
  sb: SegmentInput,
  invertido: boolean,
  problemas: string[],
): TrechoConferido {
  return {
    seq_a: seqA,
    seq_b: seqB,
    de_a: sa.from_vertex,
    ate_a: sa.to_vertex,
    de_b: invertido ? sb.to_vertex : sb.from_vertex,
    ate_b: invertido ? sb.from_vertex : sb.to_vertex,
    distancia_a: sa.distance_m,
    distancia_b: sb.distance_m,
    azimute_a: sa.azimuth_deg,
    azimute_txt_a: sa.bearing_text ?? null,
    // Com caminhamento invertido o valor exibido é o contra-azimute calculado.
    azimute_txt_b: invertido ? null : (sb.bearing_text ?? null),
    azimute_b:
      sb.azimuth_deg === null
        ? null
        : invertido
          ? (sb.azimuth_deg + 180) % 360
          : sb.azimuth_deg,
    cota_a: sa.altitude_from_m,
    cota_b: invertido ? sb.altitude_to_m : sb.altitude_from_m,
    invertido,
    ok: problemas.length === 0,
    comparado:
      (sa.distance_m !== null && sb.distance_m !== null) ||
      (sa.azimuth_deg !== null && sb.azimuth_deg !== null),
    problemas,
    confrontante_a: sa.confrontante ?? null,
    confrontante_b: sb.confrontante ?? null,
  };

}


const fmt = (n: number, d = 2) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Identidade textual do confrontante, sem referências registrais acessórias. */
function normalizeConfrontante(value: string): string {
  return normalizeName(
    value.replace(/\s*[-|,]?\s*(?:cns|matr[íi]cula)\b[\s\S]*$/i, ""),
  );
}

function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b) % 360 + 540) % 360 - 180);
}

export type SegmentPair = { ia: number; ib: number };
export type Alignment = {
  reversed: boolean;
  offset: number;
  pairs: SegmentPair[];
  cost: number;
};

/**
 * Determina a correspondência entre os segmentos de duas descrições.
 * Testa caminhamento direto e invertido (contra-azimute) e todas as
 * defasagens de vértice inicial, escolhendo a hipótese de menor custo.
 */
function alignSegments(
  segsA: SegmentInput[],
  segsB: SegmentInput[],
  tol: Tolerances,
): Alignment {
  const n = Math.min(segsA.length, segsB.length);
  const direct: Alignment = {
    reversed: false,
    offset: 0,
    pairs: Array.from({ length: n }, (_, i) => ({ ia: i, ib: i })),
    cost: 0,
  };
  if (n === 0) return direct;

  const pairCost = (sa: SegmentInput, sb: SegmentInput, reversed: boolean) => {
    let c = 0;
    let known = false;
    if (sa.distance_m !== null && sb.distance_m !== null) {
      known = true;
      c += Math.abs(sa.distance_m - sb.distance_m) / Math.max(tol.distanceM, 1e-6);
    }
    if (sa.azimuth_deg !== null && sb.azimuth_deg !== null) {
      known = true;
      const azB = reversed ? (sb.azimuth_deg + 180) % 360 : sb.azimuth_deg;
      c += angleDiff(sa.azimuth_deg, azB) / Math.max(tol.azimuthDeg, 1e-6);
    }
    return known ? c : 50; // sem dados comparáveis: penalidade neutra
  };

  const build = (reversed: boolean, offset: number): Alignment => {
    const pairs: SegmentPair[] = [];
    for (let i = 0; i < n; i += 1) {
      const ib = reversed
        ? ((offset - i) % n + n) % n
        : (i + offset) % n;
      pairs.push({ ia: i, ib });
    }
    const cost = pairs.reduce(
      (acc, p) => acc + pairCost(segsA[p.ia]!, segsB[p.ib]!, reversed),
      0,
    );
    return { reversed, offset, pairs, cost };
  };

  // Só faz sentido testar rotações quando ambas descrevem o polígono fechado
  // com o mesmo número de trechos.
  const sameCount = segsA.length === segsB.length;
  const candidates: Alignment[] = [build(false, 0)];
  if (sameCount) {
    for (let off = 0; off < n; off += 1) {
      if (off !== 0) candidates.push(build(false, off));
      candidates.push(build(true, off));
    }
  } else {
    candidates.push(build(true, n - 1));
  }

  let best = candidates[0]!;
  for (const c of candidates) {
    // margem de 1% evita trocar de hipótese por ruído numérico
    if (c.cost < best.cost * 0.99) best = c;
  }
  return best;
}


export function compareParcels(
  a: ParcelInput,
  b: ParcelInput,
  tol: Tolerances = DEFAULT_TOLERANCES,
  labels: { a: string; b: string } = { a: "Documento A", b: "Documento B" },
): ComparisonResult {
  const findings: Finding[] = [];
  const metrics: Record<string, unknown> = {};

  // --- Área ---
  if (a.area_m2 !== null && b.area_m2 !== null) {
    const diff = Math.abs(a.area_m2 - b.area_m2);
    const base = Math.max(a.area_m2, b.area_m2) || 1;
    const pct = (diff / base) * 100;
    metrics["area_diff_m2"] = diff;
    metrics["area_diff_pct"] = pct;
    if (!dentroDaTolerancia(diff, pct, tol.areaPct, tol.areaM2)) {
      findings.push({
        severity: pct > tol.areaPct * 4 && diff > tol.areaM2 * 4 ? "critical" : "moderate",
        code: "AREA_DIVERGENTE",
        title: "Divergência de área",
        description: `A área de ${labels.a} (${fmt(a.area_m2)} m²) diverge da de ${labels.b} (${fmt(b.area_m2)} m²) em ${fmt(diff)} m² (${fmt(pct, 3)}%), acima das tolerâncias de ${tol.areaPct}% e ${fmt(tol.areaM2)} m².`,
        evidence: { a: a.area_m2, b: b.area_m2, diff, pct, tolerance_pct: tol.areaPct, tolerance_m2: tol.areaM2 },
      });
    } else {
      findings.push({
        severity: "informative",
        code: "AREA_COMPATIVEL",
        title: "Área compatível",
        description: `Diferença de área de ${fmt(diff)} m² (${fmt(pct, 3)}%), dentro das tolerâncias de ${tol.areaPct}% e ${fmt(tol.areaM2)} m².`,
        evidence: { a: a.area_m2, b: b.area_m2, diff, pct },
      });
    }
  } else {
    findings.push({
      severity: "inconclusive",
      code: "AREA_AUSENTE",
      title: "Área não extraída",
      description: "A área não pôde ser identificada em ao menos um dos documentos; a comparação de área ficou inconclusiva.",
      evidence: { a: a.area_m2, b: b.area_m2 },
    });
  }

  // --- Perímetro declarado x calculado (consistência interna) ---
  [
    { p: a, name: labels.a },
    { p: b, name: labels.b },
  ].forEach(({ p, name }) => {
    if (p.declared_perimeter_m !== null && p.computed_perimeter_m !== null) {
      const diff = Math.abs(p.declared_perimeter_m - p.computed_perimeter_m);
      const pct = (diff / (p.declared_perimeter_m || 1)) * 100;
      if (!dentroDaTolerancia(diff, pct, tol.perimeterPct, tol.perimeterM)) {
        findings.push({
          severity: "moderate",
          code: "PERIMETRO_INCONSISTENTE",
          title: `Perímetro inconsistente em ${name}`,
          description: `O perímetro declarado (${fmt(p.declared_perimeter_m)} m) diverge da soma das distâncias descritas (${fmt(p.computed_perimeter_m)} m) em ${fmt(diff)} m (${fmt(pct, 3)}%).`,
          evidence: {
            declarado: p.declared_perimeter_m,
            calculado: p.computed_perimeter_m,
            diff,
            pct,
          },
        });
      }
    }
  });

  // --- Perímetro entre documentos ---
  const pa = a.declared_perimeter_m ?? a.computed_perimeter_m;
  const pb = b.declared_perimeter_m ?? b.computed_perimeter_m;
  if (pa !== null && pb !== null) {
    const diff = Math.abs(pa - pb);
    const pct = (diff / (Math.max(pa, pb) || 1)) * 100;
    metrics["perimeter_diff_m"] = diff;
    metrics["perimeter_diff_pct"] = pct;
    if (!dentroDaTolerancia(diff, pct, tol.perimeterPct, tol.perimeterM)) {
      findings.push({
        severity: "moderate",
        code: "PERIMETRO_DIVERGENTE",
        title: "Divergência de perímetro",
        description: `Perímetro de ${labels.a}: ${fmt(pa)} m; de ${labels.b}: ${fmt(pb)} m. Diferença de ${fmt(diff)} m (${fmt(pct, 3)}%).`,
        evidence: { a: pa, b: pb, diff, pct },
      });
    }
  }

  // --- Quantidade de segmentos / vértices ---
  metrics["segments_a"] = a.segments.length;
  metrics["segments_b"] = b.segments.length;
  if (a.segments.length !== b.segments.length) {
    findings.push({
      severity: "critical",
      code: "SEGMENTOS_QUANTIDADE",
      title: "Quantidade de segmentos divergente",
      description: `${labels.a} descreve ${a.segments.length} segmento(s) e ${labels.b} descreve ${b.segments.length}. A geometria descrita não é equivalente.`,
      evidence: { a: a.segments.length, b: b.segments.length },
    });
  }

  // --- Alinhamento de caminhamento (sentido e ponto de partida) ---
  // Descrições podem percorrer o perímetro em sentidos opostos (horária x
  // anti-horária) e/ou iniciar em vértices diferentes. Nesse caso, o mesmo
  // trecho de divisa aparece com o CONTRA-AZIMUTE (azimute ± 180°).
  const alignment = alignSegments(a.segments, b.segments, tol);
  metrics["alignment_mode"] = alignment.reversed ? "invertido" : "direto";
  metrics["alignment_offset"] = alignment.offset;

  if (alignment.reversed || alignment.offset !== 0) {
    findings.push({
      severity: "informative",
      code: "CAMINHAMENTO_AJUSTADO",
      title: alignment.reversed
        ? "Caminhamentos em sentidos opostos"
        : "Vértice inicial distinto",
      description: alignment.reversed
        ? `As descrições percorrem o perímetro em sentidos contrários. A conferência foi feita por contra-azimute (azimute ± 180°)${alignment.offset ? `, com defasagem de ${alignment.offset} vértice(s) no ponto de partida` : ""}. Trata-se de equivalência técnica, não de divergência.`
        : `As descrições iniciam em vértices diferentes (defasagem de ${alignment.offset} vértice(s)). A correspondência dos trechos foi ajustada antes da conferência.`,
      evidence: {
        invertido: alignment.reversed,
        defasagem: alignment.offset,
        pares: alignment.pairs.map((p) => ({ a: p.ia + 1, b: p.ib + 1 })),
      },
    });
  }

  // --- Segmento a segmento ---
  const n = alignment.pairs.length;
  let divergentSegments = 0;
  const trechos: TrechoConferido[] = [];
  for (const pair of alignment.pairs) {
    const sa = a.segments[pair.ia]!;
    const sb = b.segments[pair.ib]!;
    const problems: string[] = [];

    if (sa.distance_m !== null && sb.distance_m !== null) {
      const d = Math.abs(sa.distance_m - sb.distance_m);
      if (d > tol.distanceM) {
        problems.push(
          `distância ${fmtMedida(sa.distance_m)} m x ${fmtMedida(sb.distance_m)} m (Δ ${fmtMedida(d)} m)`,
        );
      }
    }
    if (sa.azimuth_deg !== null && sb.azimuth_deg !== null) {
      const azB = alignment.reversed
        ? (sb.azimuth_deg + 180) % 360
        : sb.azimuth_deg;
      const d = angleDiff(sa.azimuth_deg, azB);
      if (d > tol.azimuthDeg) {
        problems.push(
          alignment.reversed
            ? `azimute ${degToDms(sa.azimuth_deg)} x contra-azimute ${anguloComoModelo(azB, (sb as { bearing_text?: string | null }).bearing_text ?? null)} (original ${degToDms(sb.azimuth_deg)}, Δ ${degToDms(d)})`
            : `azimute ${degToDms(sa.azimuth_deg)} x ${degToDms(sb.azimuth_deg)} (Δ ${degToDms(d)})`,
        );
      }
    }
    // Em caminhamento invertido, o vértice inicial de A corresponde ao
    // vértice final de B (e vice-versa).
    const altPairs: [number | null, number | null, string][] = alignment.reversed
      ? [
          [sa.altitude_from_m, sb.altitude_to_m, "vértice inicial"],
          [sa.altitude_to_m, sb.altitude_from_m, "vértice final"],
        ]
      : [
          [sa.altitude_from_m, sb.altitude_from_m, "vértice inicial"],
          [sa.altitude_to_m, sb.altitude_to_m, "vértice final"],
        ];
    altPairs.forEach(([va, vb, rotulo]) => {
      if (va === null || vb === null) return;
      const d = Math.abs(va - vb);
      if (d > tol.altitudeM) {
        problems.push(
          `altitude do ${rotulo} ${fmtMedida(va)} m x ${fmtMedida(vb)} m (Δ ${fmtMedida(d)} m)`,
        );
      }
    });


    if (!tol.ignoreConfrontations && sa.confrontante && sb.confrontante) {
      if (normalizeConfrontante(sa.confrontante) !== normalizeConfrontante(sb.confrontante)) {
        problems.push(`confrontante "${sa.confrontante}" x "${sb.confrontante}"`);
      }
    }

    trechos.push(
      montarTrecho(pair.ia + 1, pair.ib + 1, sa, sb, alignment.reversed, problems),
    );

    if (problems.length > 0) {
      divergentSegments += 1;
      findings.push({
        severity: "critical",
        code: "SEGMENTO_DIVERGENTE",
        title: `Segmento ${pair.ia + 1} divergente`,
        description: `Trecho ${sa.from_vertex ?? "?"}→${sa.to_vertex ?? "?"} (correspondente ao segmento ${pair.ib + 1} de ${labels.b}): ${problems.join("; ")}.`,
        evidence: {
          seq_a: pair.ia + 1,
          seq_b: pair.ib + 1,
          invertido: alignment.reversed,
          a: tol.ignoreConfrontations ? { ...sa, confrontante: null } : sa,
          b: tol.ignoreConfrontations ? { ...sb, confrontante: null } : sb,
          problems,
        },
      });
    }
  }
  metrics["trechos"] = trechos;
  metrics["trechos_conformes"] = trechos.filter((t) => t.ok).length;
  metrics["extensao_conferida_m"] = trechos.reduce(
    (acc, t) => acc + (t.distancia_a ?? 0),
    0,
  );
  metrics["divergent_segments"] = divergentSegments;
  const naoComparados = trechos.filter((t) => t.comparado === false).length;
  metrics["trechos_nao_comparaveis"] = naoComparados;
  if (naoComparados > 0) {
    findings.push({
      severity: "inconclusive",
      code: "SEGMENTOS_SEM_DADO_COMUM",
      title: "Trechos sem dado comum para conferência",
      description: `${naoComparados} de ${trechos.length} trecho(s) não puderam ser conferidos: os documentos não trazem a mesma grandeza (distância ou azimute) para esses lados. Não se trata de divergência, mas de ausência de elemento comparável.`,
      evidence: { nao_comparaveis: naoComparados, total: trechos.length },
    });
  }

  if (n > 0 && divergentSegments === 0) {
    findings.push({
      severity: "informative",
      code: "SEGMENTOS_COMPATIVEIS",
      title: "Segmentos compatíveis",
      description: `Os ${n} segmentos comparados estão dentro das tolerâncias (${tol.distanceM} m / ${tol.azimuthDeg}°)${alignment.reversed ? ", considerando o contra-azimute pelo caminhamento inverso" : ""}.`,
      evidence: { comparados: n, invertido: alignment.reversed },
    });
  }


  // --- Altimetria (cotas dos vértices) ---
  const altA = a.altitude_mean_m;
  const altB = b.altitude_mean_m;
  if (altA !== null && altB !== null) {
    const diff = Math.abs(altA - altB);
    metrics["altitude_mean_a_m"] = altA;
    metrics["altitude_mean_b_m"] = altB;
    metrics["altitude_diff_m"] = diff;
    metrics["altitude_amplitude_a_m"] =
      a.altitude_max_m !== null && a.altitude_min_m !== null
        ? a.altitude_max_m - a.altitude_min_m
        : null;
    metrics["altitude_amplitude_b_m"] =
      b.altitude_max_m !== null && b.altitude_min_m !== null
        ? b.altitude_max_m - b.altitude_min_m
        : null;
    if (diff > tol.altitudeM) {
      findings.push({
        severity: diff > tol.altitudeM * 4 ? "critical" : "moderate",
        code: "ALTITUDE_DIVERGENTE",
        title: "Divergência altimétrica",
        description: `A altitude média dos vértices de ${labels.a} (${fmt(altA)} m) diverge da de ${labels.b} (${fmt(altB)} m) em ${fmt(diff)} m, acima da tolerância de ${tol.altitudeM} m.`,
        evidence: {
          a: { min: a.altitude_min_m, max: a.altitude_max_m, media: altA },
          b: { min: b.altitude_min_m, max: b.altitude_max_m, media: altB },
          diff,
          tolerance: tol.altitudeM,
        },
      });
    } else {
      findings.push({
        severity: "informative",
        code: "ALTITUDE_COMPATIVEL",
        title: "Altimetria compatível",
        description: `Altitude média de ${fmt(altA)} m x ${fmt(altB)} m (Δ ${fmt(diff)} m), dentro da tolerância de ${tol.altitudeM} m.`,
        evidence: { a: altA, b: altB, diff },
      });
    }
  } else if (altA !== null || altB !== null) {
    findings.push({
      severity: "inconclusive",
      code: "ALTITUDE_AUSENTE",
      title: "Altitude ausente em um dos documentos",
      description:
        "Apenas um dos documentos traz cotas altimétricas nos vértices; a conferência de altitude ficou inconclusiva.",
      evidence: { a: altA, b: altB },
    });
  }

  findings.push(
    ...findingsAltitudeZero(a, labels.a),
    ...findingsAltitudeZero(b, labels.b),
  );



  // --- Confrontantes (reciprocidade) ---
  if (!tol.ignoreConfrontations) {
    const setA = new Map(a.confrontantes.map((c) => [normalizeConfrontante(c), c]));
    const setB = new Map(b.confrontantes.map((c) => [normalizeConfrontante(c), c]));
    const onlyA = [...setA].filter(([k]) => !setB.has(k)).map(([, v]) => v);
    const onlyB = [...setB].filter(([k]) => !setA.has(k)).map(([, v]) => v);
    metrics["confrontantes_only_a"] = onlyA;
    metrics["confrontantes_only_b"] = onlyB;
    if (onlyA.length > 0 || onlyB.length > 0) {
      findings.push({
        severity: "moderate",
        code: "CONFRONTANTES_DIVERGENTES",
        title: "Confrontantes divergentes",
        description: [
          onlyA.length ? `Somente em ${labels.a}: ${onlyA.join(", ")}.` : "",
          onlyB.length ? `Somente em ${labels.b}: ${onlyB.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        evidence: { onlyA, onlyB },
      });
    } else if (setA.size > 0) {
      findings.push({
        severity: "informative",
        code: "CONFRONTANTES_COMPATIVEIS",
        title: "Confrontantes compatíveis",
        description: `Os ${setA.size} confrontantes identificados coincidem tecnicamente entre os documentos.`,
        evidence: { confrontantes: [...setA.values()] },
      });
    }
  }

  // --- Classificação final ---
  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasModerate = findings.some((f) => f.severity === "moderate");
  const onlyInconclusive =
    findings.length > 0 &&
    findings.every((f) => f.severity === "inconclusive") ;
  const noData = a.segments.length === 0 && b.segments.length === 0;

  let classification: Classification;
  if (noData || onlyInconclusive) classification = "inconclusive";
  else if (hasCritical) classification = "incompatible";
  else if (hasModerate) classification = "compatible_with_remarks";
  else classification = "compatible";

  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    moderate: findings.filter((f) => f.severity === "moderate").length,
    informative: findings.filter((f) => f.severity === "informative").length,
    inconclusive: findings.filter((f) => f.severity === "inconclusive").length,
  };
  metrics["counts"] = counts;

  const summaryByClass: Record<Classification, string> = {
    compatible:
      "Os documentos são tecnicamente compatíveis dentro das tolerâncias adotadas. Não foram identificadas divergências relevantes.",
    compatible_with_remarks:
      "Os documentos são compatíveis com ressalvas. Há divergências moderadas que exigem verificação humana antes da qualificação.",
    incompatible:
      "Foram identificadas divergências críticas entre os documentos. A equivalência técnica não se sustenta sem retificação ou esclarecimento.",
    inconclusive:
      "Não foi possível concluir: os dados técnicos extraídos são insuficientes. Revise os documentos ou informe o texto do memorial manualmente.",
  };

  const summary = `${summaryByClass[classification]} Achados: ${counts.critical} crítico(s), ${counts.moderate} moderado(s), ${counts.informative} informativo(s).`;

  return { classification, summary, metrics, findings };
}

// ---------------------------------------------------------------------------
// Modo "divisa comum entre vizinhos"
// ---------------------------------------------------------------------------
// Ao conferir dois memoriais de imóveis VIZINHOS, não faz sentido comparar área,
// perímetro total, quantidade de vértices ou reciprocidade de confrontantes:
// cada documento descreve um polígono distinto. O que se confere é a IDENTIDADE
// GEOMÉTRICA DO TRECHO COMPARTILHADO — a linha divisória comum —, ignorando os
// nomes dos vértices e admitindo caminhamentos em sentidos opostos
// (contra-azimute).

type Run = {
  reversed: boolean;
  startA: number;
  startB: number;
  length: number;
  totalDistance: number;
};

/** Casamento frouxo, usado apenas para LOCALIZAR o trecho candidato. */
function looseMatch(
  sa: SegmentInput,
  sb: SegmentInput,
  tol: Tolerances,
  reversed: boolean,
): boolean {
  if (sa.distance_m === null || sb.distance_m === null) return false;
  const dDist = Math.abs(sa.distance_m - sb.distance_m);
  const distLimit = Math.max(tol.distanceM * 10, sa.distance_m * 0.01);
  if (dDist > distLimit) return false;
  if (sa.azimuth_deg !== null && sb.azimuth_deg !== null) {
    const azB = reversed ? (sb.azimuth_deg + 180) % 360 : sb.azimuth_deg;
    if (angleDiff(sa.azimuth_deg, azB) > Math.max(tol.azimuthDeg * 20, 1)) return false;
  }
  return true;
}

function findSharedRun(
  segsA: SegmentInput[],
  segsB: SegmentInput[],
  tol: Tolerances,
): Run | null {
  let best: Run | null = null;
  for (const reversed of [false, true]) {
    for (let ia = 0; ia < segsA.length; ia += 1) {
      for (let ib = 0; ib < segsB.length; ib += 1) {
        let k = 0;
        let total = 0;
        while (
          ia + k < segsA.length &&
          (reversed ? ib - k >= 0 : ib + k < segsB.length)
        ) {
          const sa = segsA[ia + k]!;
          const sb = segsB[reversed ? ib - k : ib + k]!;
          if (!looseMatch(sa, sb, tol, reversed)) break;
          total += sa.distance_m ?? 0;
          k += 1;
        }
        if (k === 0) continue;
        const candidate: Run = {
          reversed,
          startA: ia,
          startB: ib,
          length: k,
          totalDistance: total,
        };
        if (
          !best ||
          candidate.length > best.length ||
          (candidate.length === best.length &&
            candidate.totalDistance > best.totalDistance)
        ) {
          best = candidate;
        }
      }
    }
  }
  return best;
}

export function compareSharedBoundary(
  a: ParcelInput,
  b: ParcelInput,
  tol: Tolerances = DEFAULT_TOLERANCES,
  labels: { a: string; b: string } = { a: "Documento A", b: "Documento B" },
): ComparisonResult {
  const findings: Finding[] = [];
  const metrics: Record<string, unknown> = {
    modo: "divisa_comum",
    segments_a: a.segments.length,
    segments_b: b.segments.length,
  };

  findings.push({
    severity: "informative",
    code: "MODO_DIVISA_COMUM",
    title: "Conferência de divisa comum entre vizinhos",
    description:
      "Nesta modalidade não se comparam área, perímetro total, número de vértices nem reciprocidade de confrontantes: os imóveis são distintos. Confere-se exclusivamente a identidade geométrica do trecho de divisa compartilhado (distâncias, azimutes e cotas), ignorando os nomes atribuídos aos vértices por cada descrição.",
    evidence: { segmentos_a: a.segments.length, segmentos_b: b.segments.length },
  });

  if (a.segments.length === 0 || b.segments.length === 0) {
    return {
      classification: "inconclusive",
      summary:
        "Não foi possível conferir a divisa comum: ao menos um dos documentos não teve segmentos extraídos.",
      metrics,
      findings: [
        ...findings,
        {
          severity: "inconclusive",
          code: "SEGMENTOS_AUSENTES",
          title: "Segmentos não extraídos",
          description:
            "Ao menos um dos documentos não apresentou trechos de caminhamento passíveis de conferência.",
          evidence: { a: a.segments.length, b: b.segments.length },
        },
      ],
    };
  }

  const run = findSharedRun(a.segments, b.segments, tol);

  if (!run) {
    return {
      classification: "incompatible",
      summary:
        "Nenhum trecho de divisa comum foi localizado entre as duas descrições dentro das tolerâncias adotadas.",
      metrics: { ...metrics, shared_segments: 0 },
      findings: [
        ...findings,
        {
          severity: "critical",
          code: "DIVISA_COMUM_NAO_LOCALIZADA",
          title: "Divisa comum não localizada",
          description: `Não há, entre ${labels.a} e ${labels.b}, sequência de trechos com distâncias e azimutes (ou contra-azimutes) compatíveis. A linha divisória descrita por um não corresponde à descrita pelo outro.`,
          evidence: { tolerancias: tol },
        },
      ],
    };
  }

  metrics["shared_segments"] = run.length;
  metrics["shared_length_m"] = run.totalDistance;
  metrics["alignment_mode"] = run.reversed ? "invertido" : "direto";
  metrics["shared_start_a"] = run.startA + 1;
  metrics["shared_start_b"] = run.startB + 1;

  const pares: { a: number; b: number }[] = [];
  const trechos: TrechoConferido[] = [];
  let divergentes = 0;


  for (let k = 0; k < run.length; k += 1) {
    const ia = run.startA + k;
    const ib = run.reversed ? run.startB - k : run.startB + k;
    const sa = a.segments[ia]!;
    const sb = b.segments[ib]!;
    pares.push({ a: ia + 1, b: ib + 1 });
    const problems: string[] = [];

    if (sa.distance_m !== null && sb.distance_m !== null) {
      const d = Math.abs(sa.distance_m - sb.distance_m);
      if (d > tol.distanceM) {
        problems.push(
          `distância ${fmtMedida(sa.distance_m)} m x ${fmtMedida(sb.distance_m)} m (Δ ${fmtMedida(d)} m)`,
        );
      }
    }
    if (sa.azimuth_deg !== null && sb.azimuth_deg !== null) {
      const azB = run.reversed ? (sb.azimuth_deg + 180) % 360 : sb.azimuth_deg;
      const d = angleDiff(sa.azimuth_deg, azB);
      if (d > tol.azimuthDeg) {
        problems.push(
          run.reversed
            ? `azimute ${degToDms(sa.azimuth_deg)} x contra-azimute ${anguloComoModelo(azB, (sb as { bearing_text?: string | null }).bearing_text ?? null)} (original ${degToDms(sb.azimuth_deg)}, Δ ${degToDms(d)})`
            : `azimute ${degToDms(sa.azimuth_deg)} x ${degToDms(sb.azimuth_deg)} (Δ ${degToDms(d)})`,
        );
      }
    }
    const altPairs: [number | null, number | null, string][] = run.reversed
      ? [
          [sa.altitude_from_m, sb.altitude_to_m, "vértice inicial"],
          [sa.altitude_to_m, sb.altitude_from_m, "vértice final"],
        ]
      : [
          [sa.altitude_from_m, sb.altitude_from_m, "vértice inicial"],
          [sa.altitude_to_m, sb.altitude_to_m, "vértice final"],
        ];
    altPairs.forEach(([va, vb, rotulo]) => {
      if (va === null || vb === null) return;
      const d = Math.abs(va - vb);
      if (d > tol.altitudeM) {
        problems.push(
          `altitude do ${rotulo} ${fmtMedida(va)} m x ${fmtMedida(vb)} m (Δ ${fmtMedida(d)} m)`,
        );
      }
    });


    trechos.push(montarTrecho(ia + 1, ib + 1, sa, sb, run.reversed, problems));

    if (problems.length > 0) {
      divergentes += 1;
      findings.push({
        severity: "critical",
        code: "DIVISA_COMUM_SEGMENTO_DIVERGENTE",
        title: `Trecho ${ia + 1} da divisa comum divergente`,
        description: `Trecho ${sa.from_vertex ?? "?"}→${sa.to_vertex ?? "?"} de ${labels.a}, correspondente ao trecho ${ib + 1} (${sb.from_vertex ?? "?"}→${sb.to_vertex ?? "?"}) de ${labels.b}: ${problems.join("; ")}.`,
        evidence: { seq_a: ia + 1, seq_b: ib + 1, invertido: run.reversed, a: sa, b: sb, problems },
      });
    }
  }

  metrics["shared_pairs"] = pares;
  metrics["trechos"] = trechos;
  metrics["trechos_conformes"] = trechos.filter((t) => t.ok).length;
  metrics["extensao_conferida_m"] = run.totalDistance;
  metrics["divergent_segments"] = divergentes;

  findings.push(
    ...findingsAltitudeZero(a, labels.a),
    ...findingsAltitudeZero(b, labels.b),
  );




  findings.push({
    severity: "informative",
    code: "DIVISA_COMUM_LOCALIZADA",
    title: "Trecho de divisa comum identificado",
    description: `Foram identificados ${run.length} trecho(s) contíguo(s) correspondentes, totalizando ${fmt(run.totalDistance, 3)} m de linha divisória comum. Correspondência: trecho ${run.startA + 1} de ${labels.a} ↔ trecho ${run.startB + 1} de ${labels.b}, em caminhamento ${run.reversed ? "invertido (conferido por contra-azimute)" : "no mesmo sentido"}. Os nomes dos vértices não foram considerados na conferência.`,
    evidence: {
      pares,
      invertido: run.reversed,
      extensao_m: run.totalDistance,
      trechos: run.length,
    },
  });

  // Trechos do documento A que não integram a divisa comum são apenas contexto.
  const foraA = a.segments.length - run.length;
  const foraB = b.segments.length - run.length;
  if (foraA > 0 || foraB > 0) {
    findings.push({
      severity: "informative",
      code: "TRECHOS_NAO_COMPARTILHADOS",
      title: "Trechos fora da divisa comum",
      description: `${foraA} trecho(s) de ${labels.a} e ${foraB} trecho(s) de ${labels.b} descrevem divisas com outros confrontantes e não integram a linha comum — não foram conferidos.`,
      evidence: { fora_a: foraA, fora_b: foraB },
    });
  }

  if (divergentes === 0 && run.length === 1) {
    findings.push({
      severity: "moderate",
      code: "DIVISA_COMUM_TRECHO_UNICO",
      title: "Divisa comum limitada a um único trecho",
      description:
        "Apenas um trecho correspondente foi localizado. Confirme se a divisa comum é realmente composta por uma única linha reta antes de concluir.",
      evidence: { trechos: run.length },
    });
  }

  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    moderate: findings.filter((f) => f.severity === "moderate").length,
    informative: findings.filter((f) => f.severity === "informative").length,
    inconclusive: findings.filter((f) => f.severity === "inconclusive").length,
  };
  metrics["counts"] = counts;

  let classification: Classification;
  if (counts.critical > 0) classification = "incompatible";
  else if (counts.moderate > 0) classification = "compatible_with_remarks";
  else classification = "compatible";

  const summaryByClass: Record<Classification, string> = {
    compatible: `A linha divisória comum é tecnicamente idêntica: ${run.length} trecho(s), ${fmt(run.totalDistance, 3)} m, dentro das tolerâncias adotadas${run.reversed ? " (caminhamentos em sentidos opostos, conferidos por contra-azimute)" : ""}.`,
    compatible_with_remarks: `A divisa comum foi localizada (${run.length} trecho(s), ${fmt(run.totalDistance, 3)} m), mas há ressalvas que exigem verificação humana.`,
    incompatible: `A divisa comum foi localizada (${run.length} trecho(s)), porém ${divergentes} trecho(s) apresentam divergência acima da tolerância. A identidade da linha não se sustenta sem retificação.`,
    inconclusive: "Conferência inconclusiva.",
  };

  return {
    classification,
    summary: `${summaryByClass[classification]} Achados: ${counts.critical} crítico(s), ${counts.moderate} moderado(s), ${counts.informative} informativo(s).`,
    metrics,
    findings,
  };
}

/**
 * Altitude igual a zero em qualquer vértice indica cota não informada ou erro
 * de digitação/extração: o sistema alerta sempre que ocorrer.
 */
function findingsAltitudeZero(p: ParcelInput, rotulo: string): Finding[] {
  const zerados: { trecho: number; vertice: string }[] = [];
  p.segments.forEach((s, i) => {
    if (s.altitude_from_m === 0)
      zerados.push({ trecho: i + 1, vertice: s.from_vertex ?? `${i + 1}` });
    if (s.altitude_to_m === 0)
      zerados.push({ trecho: i + 1, vertice: s.to_vertex ?? `${i + 2}` });
  });
  if (zerados.length === 0) return [];
  const unicos = [...new Map(zerados.map((z) => [z.vertice, z])).values()];
  return [
    {
      severity: "critical",
      code: "ALTITUDE_ZERO",
      title: "Altitude igual a zero",
      description: `Em ${rotulo}, ${unicos.length} vértice(s) apresentam altitude igual a 0,00 m (${unicos
        .map((z) => z.vertice)
        .join(", ")}). Cota zerada normalmente indica altitude não informada ou erro de digitação/extração e deve ser verificada.`,
      evidence: { documento: rotulo, vertices: unicos },
    },
  ];
}

// ---------------------------------------------------------------------------
// Modo "memorial x planta" (conferência parcial)
//
// A planta é representação gráfica: pode cotar apenas algumas medidas. A
// AUSÊNCIA de medida na planta não é divergência. Já a medida COTADA na planta
// não pode divergir da descrita no memorial.

/** Melhor correspondente do segmento da planta entre os trechos do memorial. */
function melhorCorrespondente(
  sp: SegmentInput,
  memorial: SegmentInput[],
  usados: Set<number>,
  tol: Tolerances,
): { idx: number; custo: number; invertido: boolean } | null {
  let melhor: { idx: number; custo: number; invertido: boolean } | null = null;
  memorial.forEach((sm, i) => {
    if (usados.has(i)) return;
    for (const invertido of [false, true]) {
      let custo = 0;
      let comparavel = false;
      if (sp.distance_m !== null && sm.distance_m !== null) {
        comparavel = true;
        custo += Math.abs(sp.distance_m - sm.distance_m);
      }
      if (sp.azimuth_deg !== null && sm.azimuth_deg !== null) {
        comparavel = true;
        const az = invertido ? (sp.azimuth_deg + 180) % 360 : sp.azimuth_deg;
        custo += angleDiff(sm.azimuth_deg, az) / 10;
      }
      if (!comparavel) continue;
      if (!melhor || custo < melhor.custo) melhor = { idx: i, custo, invertido };
    }
  });
  return melhor;
}

/**
 * Confere um lote/quadra do memorial contra a mesma figura na planta,
 * considerando APENAS as grandezas efetivamente cotadas na planta.
 */
export function compareMemorialToPlan(
  memorial: ParcelInput,
  planta: ParcelInput,
  tol: Tolerances = DEFAULT_TOLERANCES,
  labels: { a: string; b: string } = { a: "Memorial", b: "Planta" },
): ComparisonResult {
  const findings: Finding[] = [];
  const metrics: Record<string, unknown> = {
    modo: "memorial_x_planta",
    segments_a: memorial.segments.length,
    segments_b: planta.segments.length,
  };

  findings.push({
    severity: "informative",
    code: "MODO_MEMORIAL_PLANTA",
    title: "Conferência memorial × planta (medidas parciais)",
    description:
      "A planta é representação gráfica e pode não cotar todas as medidas: a ausência de cota não é tratada como divergência. Confere-se apenas cada medida efetivamente representada na planta (distância, azimute, cota altimétrica, área e perímetro), que deve coincidir com a do memorial.",
    evidence: {
      segmentos_memorial: memorial.segments.length,
      segmentos_planta: planta.segments.length,
    },
  });

  // --- Área: só se a planta declarar ---
  if (planta.area_m2 !== null && memorial.area_m2 !== null) {
    const diff = Math.abs(planta.area_m2 - memorial.area_m2);
    const pct = (diff / (Math.max(planta.area_m2, memorial.area_m2) || 1)) * 100;
    metrics["area_diff_m2"] = diff;
    metrics["area_diff_pct"] = pct;
    findings.push(
      !dentroDaTolerancia(diff, pct, tol.areaPct, tol.areaM2)

        ? {
            severity: "critical",
            code: "AREA_DIVERGENTE",
            title: "Área da planta diverge do memorial",
            description: `Área no memorial: ${fmt(memorial.area_m2)} m²; na planta: ${fmt(planta.area_m2)} m². Diferença de ${fmt(diff)} m² (${fmt(pct, 3)}%).`,
            evidence: { memorial: memorial.area_m2, planta: planta.area_m2, diff, pct },
          }
        : {
            severity: "informative",
            code: "AREA_COMPATIVEL",
            title: "Área compatível",
            description: `A área cotada na planta coincide com a do memorial (${fmt(memorial.area_m2)} m²).`,
            evidence: { memorial: memorial.area_m2, planta: planta.area_m2 },
          },
    );
  } else if (planta.area_m2 === null) {
    findings.push({
      severity: "informative",
      code: "AREA_NAO_COTADA",
      title: "Área não cotada na planta",
      description:
        "A planta não traz a área da figura. Por ser representação gráfica, a ausência não constitui divergência.",
      evidence: { memorial: memorial.area_m2 },
    });
  }

  // --- Perímetro: só se a planta trouxer ---
  const pp = planta.declared_perimeter_m ?? planta.computed_perimeter_m;
  const pm = memorial.declared_perimeter_m ?? memorial.computed_perimeter_m;
  if (pp !== null && pm !== null && planta.segments.length === memorial.segments.length) {
    const diff = Math.abs(pp - pm);
    const pct = (diff / (Math.max(pp, pm) || 1)) * 100;
    metrics["perimeter_diff_m"] = diff;
    if (!dentroDaTolerancia(diff, pct, tol.perimeterPct, tol.perimeterM)) {
      findings.push({
        severity: "moderate",
        code: "PERIMETRO_DIVERGENTE",
        title: "Perímetro divergente",
        description: `Perímetro no memorial: ${fmt(pm)} m; na planta: ${fmt(pp)} m (Δ ${fmt(diff)} m). As duas descrições têm o mesmo número de lados, de modo que o total é comparável.`,
        evidence: { memorial: pm, planta: pp, diff, pct },
      });
    }
  }

  // --- Medida a medida, a partir da planta ---
  const usados = new Set<number>();
  const trechos: TrechoConferido[] = [];
  let divergentes = 0;
  let conferidos = 0;
  let semCorrespondente = 0;

  planta.segments.forEach((sp, ip) => {
    if (sp.distance_m === null && sp.azimuth_deg === null) return;
    const match = melhorCorrespondente(sp, memorial.segments, usados, tol);
    if (!match) {
      semCorrespondente += 1;
      return;
    }
    usados.add(match.idx);
    const sm = memorial.segments[match.idx]!;
    const problemas: string[] = [];

    if (sp.distance_m !== null && sm.distance_m !== null) {
      const d = Math.abs(sp.distance_m - sm.distance_m);
      if (d > tol.distanceM) {
        problemas.push(
          `distância memorial ${fmtMedida(sm.distance_m)} m x planta ${fmtMedida(sp.distance_m)} m (Δ ${fmtMedida(d)} m)`,
        );
      }
    }
    if (sp.azimuth_deg !== null && sm.azimuth_deg !== null) {
      const azP = match.invertido ? (sp.azimuth_deg + 180) % 360 : sp.azimuth_deg;
      const d = angleDiff(sm.azimuth_deg, azP);
      if (d > tol.azimuthDeg) {
        problemas.push(
          `azimute memorial ${degToDms(sm.azimuth_deg)} x planta ${degToDms(azP)} (Δ ${degToDms(d)})`,
        );
      }
    }
    ([
      [sm.altitude_from_m, sp.altitude_from_m, "vértice inicial"],
      [sm.altitude_to_m, sp.altitude_to_m, "vértice final"],
    ] as [number | null, number | null, string][]).forEach(([vm, vp, rotulo]) => {
      if (vm === null || vp === null) return;
      const d = Math.abs(vm - vp);
      if (d > tol.altitudeM) {
        problemas.push(
          `altitude do ${rotulo} memorial ${fmtMedida(vm)} m x planta ${fmtMedida(vp)} m (Δ ${fmtMedida(d)} m)`,
        );
      }
    });

    conferidos += 1;
    trechos.push(
      montarTrecho(match.idx + 1, ip + 1, sm, sp, match.invertido, problemas),
    );

    if (problemas.length > 0) {
      divergentes += 1;
      findings.push({
        severity: "critical",
        code: "MEDIDA_PLANTA_DIVERGENTE",
        title: `Medida da planta divergente (lado ${ip + 1})`,
        description: `O lado ${ip + 1} cotado na planta não confere com o trecho ${match.idx + 1} do memorial (${sm.from_vertex ?? "?"}→${sm.to_vertex ?? "?"}): ${problemas.join("; ")}.`,
        evidence: { planta: sp, memorial: sm, problemas, invertido: match.invertido },
      });
    }
  });

  const naoCotados = Math.max(0, memorial.segments.length - conferidos);
  metrics["trechos"] = trechos;
  metrics["trechos_conformes"] = trechos.filter((t) => t.ok).length;
  metrics["medidas_conferidas"] = conferidos;
  metrics["medidas_divergentes"] = divergentes;
  metrics["lados_nao_cotados_na_planta"] = naoCotados;
  metrics["extensao_conferida_m"] = trechos.reduce(
    (acc, t) => acc + (t.distancia_a ?? 0),
    0,
  );

  if (naoCotados > 0) {
    findings.push({
      severity: "informative",
      code: "LADOS_NAO_COTADOS",
      title: "Lados sem cota na planta",
      description: `${naoCotados} lado(s) descritos no memorial não têm medida representada na planta e, portanto, não foram conferidos. Isso não constitui divergência.`,
      evidence: { nao_cotados: naoCotados, conferidos },
    });
  }
  if (semCorrespondente > 0) {
    findings.push({
      severity: "moderate",
      code: "MEDIDA_SEM_CORRESPONDENTE",
      title: "Medida da planta sem correspondente no memorial",
      description: `${semCorrespondente} medida(s) cotada(s) na planta não encontraram lado correspondente no memorial. Verifique se a figura conferida é a mesma.`,
      evidence: { sem_correspondente: semCorrespondente },
    });
  }
  if (conferidos === 0) {
    findings.push({
      severity: "inconclusive",
      code: "PLANTA_SEM_MEDIDAS",
      title: "Planta sem medidas comparáveis",
      description:
        "A planta não trouxe medidas passíveis de conferência para esta figura. Nada foi confrontado.",
      evidence: {},
    });
  }

  findings.push(...findingsAltitudeZero(memorial, labels.a));
  findings.push(...findingsAltitudeZero(planta, labels.b));

  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    moderate: findings.filter((f) => f.severity === "moderate").length,
    informative: findings.filter((f) => f.severity === "informative").length,
    inconclusive: findings.filter((f) => f.severity === "inconclusive").length,
  };
  metrics["counts"] = counts;

  let classification: Classification;
  if (conferidos === 0) classification = "inconclusive";
  else if (counts.critical > 0) classification = "incompatible";
  else if (counts.moderate > 0) classification = "compatible_with_remarks";
  else classification = "compatible";

  const resumo: Record<Classification, string> = {
    compatible: `Todas as ${conferidos} medida(s) cotada(s) na planta conferem com o memorial${naoCotados ? `; ${naoCotados} lado(s) não têm cota na planta e não foram conferidos` : ""}.`,
    compatible_with_remarks: `As medidas cotadas na planta conferem com o memorial, com ressalvas a verificar.`,
    incompatible: `${divergentes} medida(s) cotada(s) na planta divergem do memorial.`,
    inconclusive: "Não havia medida cotada na planta para conferir.",
  };

  return {
    classification,
    summary: `${resumo[classification]} Achados: ${counts.critical} crítico(s), ${counts.moderate} moderado(s), ${counts.informative} informativo(s).`,
    metrics,
    findings,
  };
}
