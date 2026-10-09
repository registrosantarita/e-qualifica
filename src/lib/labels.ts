export const STATUS_ANALISE: Record<string, string> = {
  draft: "Rascunho",
  processing: "Processando",
  ready: "Pronta",
  review_pending: "Aguardando revisão",
  completed: "Concluída",
  archived: "Arquivada",
  error: "Erro",
};

export const STATUS_ANALISE_CLASS: Record<string, string> = {
  draft: "border border-border bg-muted text-muted-foreground",
  processing: "border border-warning/40 bg-warning/15 text-warning-foreground",
  ready: "border border-success/40 bg-success/10 text-success",
  review_pending: "border border-accent/40 bg-accent/15 text-accent-foreground",
  completed: "border border-primary/40 bg-primary/15 text-primary",
  archived: "border border-border bg-muted text-muted-foreground",
  error: "border border-destructive/40 bg-destructive/10 text-destructive",
};


export const STATUS_DOCUMENTO: Record<string, string> = {
  uploaded: "Recebido",
  parsed: "Extraído",
  failed: "Falha na extração",
  archived: "Arquivado",
};

export const CATEGORIA_DOCUMENTO: Record<string, string> = {
  memorial: "Memorial descritivo",
  matricula: "Matrícula",
  escritura: "Escritura",
  planta: "Planta",
  norma: "Norma",
  tabela_tecnica: "Tabela técnica",
  imagem_tecnica: "Imagem técnica",
  documento_complementar: "Documento complementar",
  nao_classificado: "Não classificado",
};

export const TIPO_COMPARACAO: Record<string, string> = {
  memorial_to_memorial: "Memorial x Memorial",
  memorial_to_plan: "Memorial x Planta",
  plan_to_plan: "Planta x Planta",
  memorial_to_title: "Memorial x Escritura / Título",
  boundary_to_boundary: "Divisa comum entre vizinhos",
  memorial_to_registry: "Memorial x Matrícula",
  custom: "Comparação múltipla (paradigma × B, C, D…)",
};

export const CLASSIFICACAO: Record<
  string,
  { label: string; tone: "success" | "warning" | "destructive" | "muted" }
> = {
  compatible: { label: "Compatível", tone: "success" },
  compatible_with_remarks: { label: "Compatível com ressalvas", tone: "warning" },
  incompatible: { label: "Incompatível", tone: "destructive" },
  inconclusive: { label: "Inconclusivo", tone: "muted" },
};

export const SEVERIDADE: Record<
  string,
  { label: string; tone: "success" | "warning" | "destructive" | "muted" }
> = {
  critical: { label: "Crítico", tone: "destructive" },
  moderate: { label: "Moderado", tone: "warning" },
  informative: { label: "Informativo", tone: "success" },
  inconclusive: { label: "Inconclusivo", tone: "muted" },
};

export const TONE_CLASS: Record<string, string> = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/50 bg-warning/15 text-warning-foreground",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

export function fmtNum(value: number | string | null, digits = 2): string {
  if (value === null || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Ângulo em grau/minuto/segundo respeitando a precisão do documento de origem:
 * não completa casas que não foram informadas (45°12' permanece 45°12').
 */
/** Decompõe graus decimais em g/m/s sem arredondar o que não existe. */
function decompor(abs: number, casasSeg: number) {
  let d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  let m = Math.floor(mFloat + 1e-9);
  const fator = 10 ** casasSeg;
  let s = Math.round((mFloat - m) * 60 * fator) / fator;
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    d += 1;
  }
  return { d, m, s };
}

/** Segundos sem zeros artificiais: 24,443 / 07 / 12,5 */
function segundosStr(s: number, casas: number): string {
  const txt = s.toFixed(casas);
  const [int, frac = ""] = txt.split(".");
  const base = int!.padStart(2, "0");
  const fracLimpa = frac.replace(/0+$/, "");
  return fracLimpa ? `${base},${fracLimpa}` : base;
}

export function degToDms(value: number | string | null): string {
  if (value === null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  const sinal = n < 0 ? "-" : "";
  let { d, m, s } = decompor(Math.abs(n), 2);
  // Ruído de conversão: segundos praticamente inteiros voltam a ser inteiros.
  const inteiro = Math.round(s);
  if (Math.abs(s - inteiro) < 0.02) s = inteiro;
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    d += 1;
  }
  // Os documentos sempre trazem minutos e segundos, mesmo zerados: 339°13'00".
  const mm = String(m).padStart(2, "0");
  return `${sinal}${d}°${mm}'${segundosStr(s, 2)}"`;
}


/**
 * Latitude/longitude em grau, minuto e segundo, com sinal e hemisfério.
 * Os segundos voltam exatamente com as casas do documento de origem: o valor
 * decimal é reconvertido e "encaixado" na menor precisão que o reproduz,
 * eliminando o ruído de ponto flutuante (…32,956001 → …32,956).
 */
export function coordToDms(
  value: number | string | null | undefined,
  eixo: "lat" | "lon",
  original?: string | null,
): string {
  // A fonte literal é autoritativa; não reconstruir segundos a partir de floats.
  if (original?.trim()) return original.trim().replace(/(?<=\d)\.(?=\d)/g, ",");
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  const negativo = n < 0;
  const hemisferio = eixo === "lat" ? (negativo ? "S" : "N") : negativo ? "W" : "E";
  const { d, m, s } = decompor(Math.abs(n), 6);
  // Menor número de casas de segundo que reproduz o valor informado.
  let casas = 6;
  for (let c = 0; c <= 6; c++) {
    if (Math.abs(s - Number(s.toFixed(c))) < 1e-8) {
      casas = c;
      break;
    }
  }
  // Sem fonte literal (legados/geometrias), limitar apenas ruído numérico.
  const txt = s.toFixed(casas).replace(".", ",");
  const [int = "", frac] = txt.split(",");
  const seg = frac ? `${int.padStart(2, "0")},${frac}` : int.padStart(2, "0");
  const sinal = negativo ? "-" : "";

  return `${sinal}${d}°${String(m).padStart(2, "0")}'${seg}"${hemisferio}`;
}




/** Casas decimais efetivamente informadas na medida de origem (máx. 6). */
export function casasDecimais(value: number | string | null): number {
  if (value === null || value === "") return 0;
  const n = typeof value === "string" ? Number(String(value).replace(",", ".")) : value;
  if (!Number.isFinite(n)) return 0;
  const s = String(Number(n.toFixed(6)));
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Medida (distância, altitude, área) com a mesma precisão do documento de
 * origem: mínimo de 2 casas, no máximo as casas efetivamente informadas.
 */
export function fmtMedida(value: number | string | null, min = 2, max = 6): string {
  if (value === null || value === "") return "—";
  const n = typeof value === "string" ? Number(String(value).replace(",", ".")) : value;
  if (!Number.isFinite(n)) return "—";
  const d = Math.min(max, Math.max(min, casasDecimais(n)));
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Estrutura (grau / minuto / segundo e casas) de um ângulo escrito no documento. */
/**
 * Estrutura literal de um ângulo. Os minutos podem vir SEM apóstrofe
 * ("142°34"), como ocorre em memoriais digitalizados: nesse caso os dígitos
 * seguintes ao grau ainda são minutos e não podem ser descartados.
 */
const ANGULO_LITERAL_RE =
  /(-?\d{1,3})\s*[°º]\s*(?:(\d{1,2})\s*(?:['\u2032´`]|(?![\d.,])))?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*["\u2033'']?)?/;

function estruturaAngulo(
  texto: string | null | undefined,
): { min: boolean; seg: boolean; casas: number } | null {
  const t = (texto ?? "").trim();
  const m = t.match(ANGULO_LITERAL_RE);
  if (!m || !m[1]) return null;
  if (m[2] === undefined) return { min: false, seg: false, casas: 0 };
  if (m[3] === undefined) return { min: true, seg: false, casas: 0 };
  const frac = m[3].replace(".", ",").split(",")[1] ?? "";
  return { min: true, seg: true, casas: frac.length };
}

/**
 * Valor calculado (ex.: contra-azimute) impresso com a MESMA estrutura do
 * ângulo de origem: se o documento não traz segundos, o calculado também não.
 */
export function anguloComoModelo(
  valor: number | string | null,
  modelo: string | null | undefined,
): string {
  const est = estruturaAngulo(modelo);
  if (!est) return degToDms(valor);
  if (valor === null || valor === "") return "—";
  const n = typeof valor === "string" ? Number(valor) : valor;
  if (!Number.isFinite(n)) return "—";
  const sinal = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (!est.min) return `${sinal}${Math.round(abs)}°`;
  if (!est.seg) {
    let d = Math.trunc(abs);
    let mm = Math.round((abs - d) * 60);
    if (mm >= 60) {
      mm -= 60;
      d += 1;
    }
    return `${sinal}${d}°${String(mm).padStart(2, "0")}'`;
  }
  let { d, m: mi, s } = decompor(abs, est.casas);
  let ss = s.toFixed(est.casas);
  if (Number(ss) >= 60) {
    ss = (0).toFixed(est.casas);
    mi += 1;
  }
  if (mi >= 60) {
    mi -= 60;
    d += 1;
  }
  const [si = "", sf] = ss.split(".");
  const segTxt = sf ? `${si.padStart(2, "0")},${sf}` : si.padStart(2, "0");
  return `${sinal}${d}°${String(mi).padStart(2, "0")}'${segTxt}"`;
}

/**
 * Ângulo com a literalidade do documento: se o texto de origem traz segundos,
 * eles aparecem; se traz apenas grau e minuto, nada é completado.
 * Sem texto próprio (valor calculado), segue a estrutura do ângulo modelo.
 */
export function anguloLiteral(
  texto: string | null | undefined,
  valor: number | string | null,
  modelo?: string | null,
): string {
  const t = (texto ?? "").trim();
  const m = t.match(ANGULO_LITERAL_RE);
  if (m && m[1]) {
    const g = m[1];
    if (m[2] === undefined) return `${g}°`;
    const mm = m[2].padStart(2, "0");
    if (m[3] === undefined) return `${g}°${mm}'`;
    const [si, sf] = m[3].replace(".", ",").split(",");
    const ss = (si ?? "0").padStart(2, "0");
    return `${g}°${mm}'${sf ? `${ss},${sf}` : ss}"`;
  }
  if (modelo) return anguloComoModelo(valor, modelo);
  return degToDms(valor);
}


/** Ângulo/azimute sempre em grau, minuto e segundo. */
export function fmtAngulo(value: number | string | null): string {
  return degToDms(value === "" ? null : (value as number | string | null));
}

/** Cor de identificação de cada documento comparado (A, B, C, D, ...). */
const DOC_CLASSES = [
  "doc-a",
  "doc-b",
  "doc-c",
  "doc-d",
  "doc-e",
  "doc-f",
  "doc-g",
  "doc-h",
] as const;

export function docColor(indice: number): string {
  return DOC_CLASSES[indice % DOC_CLASSES.length]!;
}

/** Letra do documento na ordem de comparação: 0 → A, 1 → B, ... */
export function docLetra(indice: number): string {
  return String.fromCharCode(65 + (indice % 26));
}
