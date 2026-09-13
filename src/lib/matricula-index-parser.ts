/**
 * CheckIndex — extração determinística de dados estruturados de matrículas
 * digitalizadas. Apenas expressões regulares e normalizações: nenhum crédito
 * de IA é consumido nesta etapa.
 */

import { nomeValido } from "./qualificacao-parser";



export type IndexProprietario = {
  nome: string | null;
  cpf_cnpj: string | null;
  fracao: string | null;
  /** ATIVO = proprietário atual; INATIVO = titular anterior (transmitente). */
  situacao?: "ATIVO" | "INATIVO";
};

export type IndexAto = {
  tipo: string | null;
  numero: string | null;
  data: string | null;
  descricao: string;
  /** Gravame identificado (hipoteca, penhora…), quando o ato for ônus. */
  gravame?: string | null;
  /** false quando houver averbação de cancelamento/baixa do gravame. */
  vigente?: boolean;
  /** Ato que cancelou o gravame (ex.: AV.07). */
  cancelado_por?: string | null;
};

export type IndexPagina = {
  nome: string;
  matricula: string | null;
  folha: string | null;
  ordem: number;
  qualidade: number;
  alertas: string[];
};

export type IndexEvidencia = {
  ato: string | null;
  trecho: string;
  confianca: "alta" | "media" | "baixa";
};


export type IndexCadastros = {
  /** Comum a urbano e rural. */
  cib: string | null;
  /** Cadastro imobiliário municipal (urbano). */
  cim: string | null;
  /** Rurais. */
  ccir: string | null;
  car: string | null;
};

export type MatriculaIndexada = {
  /** 2 = Matrícula; 3 = Registro Auxiliar. */
  tipo_livro: 2 | 3;
  /** Número do livro (matrícula ou registro auxiliar), com separador de milhar. */
  livro: string | null;
  /** Espelho de `livro`, usado apenas nos rótulos internos do CheckIndex. */
  matricula_numero: string | null;
  /** CNS do Livro no padrão CNJ: CCCCCC.L.NNNNNNN-DD. */
  cns: string | null;
  data_abertura: string | null;
  /** Número da última ficha, com V quando verso. */
  ultima_ficha: string | null;
  /** Rótulo do último ato sequencial de registro ou averbação (R.05, AV.08). */
  ultimo_ato: string | null;
  /** Origem da matrícula (R.01/M.10.345, AV.01/M.9.856, TR.12.456/L.3-K). */
  registro_anterior: string | null;
  encerrada: boolean;
  /** Matrículas abertas a partir desta, quando encerrada. */
  matriculas_abertas: string[];
  natureza: "urbano" | "rural" | "nao_identificado";
  /** Identificação comum. */
  cep: string | null;
  /** Identificação urbana. */
  tipo_logradouro: string | null;
  logradouro: string | null;
  numero_logradouro: string | null;
  bairro: string | null;
  lote: string | null;
  quadra: string | null;
  condominio: string | null;
  unidade: string | null;
  andar: string | null;
  bloco: string | null;
  /** Identificação rural. */
  tipo_rural: string | null;
  denominacao_rural: string | null;
  /** Certificação do INCRA (rurais georreferenciados). */
  certificacao: string | null;
  cadastros: IndexCadastros;
  /** Medidas. */
  area_m2: number | null;
  area_hectare: number | null;
  perimetro_m: number | null;
  area_construida_m2: number | null;
  /** Descrição tabular do imóvel (apoio interno). */
  descricao: string;
  /** Atos registrados. */
  prenotacao: string | null;
  /** R. (registro) ou AV. (averbação). */
  tipo_ato: string | null;
  /** Número do ato (01, 05, 10). */
  ato: string | null;
  data_ato: string | null;
  selo: string | null;
  /** Titulares de direitos reais. */
  adquirente: string | null;
  conjuge_adq: string | null;
  transmitente: string | null;
  conjuge_transm: string | null;
  usufrutuario: string | null;
  conjuge_usu: string | null;
  outorgante: string | null;
  conjuge_outorgante: string | null;
  outorgado: string | null;
  conjuge_outorgado: string | null;
  credor: string | null;
  devedor: string | null;
  /** Servidão: quem suporta o ônus. */
  serviente: string | null;
  /** Servidão: quem usufrui do benefício. */
  dominante: string | null;
  /** Qualificação do titular. */
  estado_civil: string | null;
  data_casamento: string | null;
  lei_casamento: string | null;
  reg_bens: string | null;
  pacto: string | null;
  /** Endereço do titular (não necessariamente o do imóvel). */
  endereco: string;
  email: string | null;
  telefone: string | null;
  /** CPF/CNPJ. */
  identificacao: string | null;
  /** NIRE/RCPJ para pessoas jurídicas. */
  inscricao_estadual: string | null;
  situacao_titulares: "ATIVO" | "INATIVO" | null;
  proprietarios: IndexProprietario[];
  atos: IndexAto[];
  /** Ônus ainda vigentes (cancelados são excluídos daqui). */
  onus: IndexAto[];
  /** Ônus baixados/cancelados, mantidos para auditoria. */
  onus_cancelados: IndexAto[];
  /** Evidência literal usada para os principais campos sugeridos. */
  evidencias: Record<string, IndexEvidencia>;
};



const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ",
  "RN","RS","RO","RR","SC","SP","SE","TO",
];

const MESES: Record<string, string> = {
  janeiro: "01", fevereiro: "02", marco: "03", "março": "03", abril: "04", maio: "05",
  junho: "06", julho: "07", agosto: "08", setembro: "09", outubro: "10",
  novembro: "11", dezembro: "12",
};

const limpar = (v: string | undefined | null): string | null => {
  const s = (v ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
  return s ? s : null;
};

const digitos = (v: string): string => v.replace(/\D/g, "");

/** Corrige somente rótulos registrais inequívocos; nomes e números nunca são adivinhados. */
export function normalizarTextoRegistral(texto: string): string {
  return texto
    .replace(/\r/g, "")
    .replace(/\bA[MN]CRA\b/gi, "INCRA")
    .replace(/\bNIRE(?=\s*[:.]?\s*0[.,]\d)/gi, "NIRF")
    .replace(/\bMATR[IÍ]CULA\s*[-–—]?\s*[|Il]\s*\(um\)/gi, "MATRÍCULA 1")
    .replace(/\bA\s*V\s*[.\-]\s*(\d+)/gi, "AV.$1")
    .replace(/\b(?:n[º°]|n[oO])\b/g, "nº")
    .replace(/[ \t]+\n/g, "\n");
}

export function avaliarQualidadeOcr(texto: string): { score: number; alertas: string[] } {
  const alertas: string[] = [];
  const limpo = texto.trim();
  if (limpo.length < 200) alertas.push("Pouco texto reconhecido");
  const simbolos = (limpo.match(/[|{}<>~=]{1,}|[;]{4,}/g) ?? []).length;
  const palavras = limpo.match(/[A-Za-zÀ-ÿ]{3,}/g)?.length ?? 0;
  if (simbolos > Math.max(3, palavras * 0.03)) alertas.push("Excesso de símbolos do OCR");
  if (/\b(?:ANCRA|CAPELLAR!|PROTOCOL0|MATR[1l]CULA)\b/i.test(limpo)) alertas.push("Caracteres possivelmente trocados");
  if (!/\b(?:R|AV)\s*[.\-/]?\s*\d+/i.test(limpo)) alertas.push("Marcadores de atos pouco legíveis");
  return { score: Math.max(0, 100 - alertas.length * 22), alertas };
}

export function identificarPaginaMatricula(textoBruto: string, nome = "página"): IndexPagina {
  const texto = normalizarTextoRegistral(textoBruto).replace(/\s+/g, " ");
  const referenciasAtos = [...texto.matchAll(/\b(?:R|AV)\s*[.\-/]?\s*\d+\s*[.\-/]\s*M\s*[.\-]?\s*(\d{1,3}(?:\.\d{3})*|\d+)\s*[:=]/gi)]
    .map((m) => m[1] ?? "")
    .filter(Boolean);
  const matriculaDosAtos = referenciasAtos.length
    ? [...new Set(referenciasAtos)].sort((a, b) => referenciasAtos.filter((v) => v === b).length - referenciasAtos.filter((v) => v === a).length)[0]
    : null;
  const matriculaCabecalho = capturar(texto.slice(0, 450), [
    /matr[ií]cul[ae]\s*(?:n[.º°]*)?\s*[:\-]?\s*(\d{1,3}(?:\.\d{3})*|\d+)\s+(?:folha|ficha)/i,
    /matr[ií]cul[ae]\s+folha\s+(?:[|Il1]\s*\(um\)|0*[1Il])\b/i,
  ]);
  const matricula = matriculaDosAtos ?? matriculaCabecalho;
  const folha = capturar(texto, [
    /folha\s*(?:n[.º°]*)?\s*[:\-]?\s*(\d{1,4})\s*(v(?:erso)?|vº)?/i,
  ]);
  const folhaMatch = texto.match(/folha\s*(?:n[.º°]*)?\s*[:\-]?\s*(\d{1,4})\s*(v(?:erso)?|vº)?/i);
  const numeroFolha = Number(digitos(folhaMatch?.[1] ?? folha ?? "")) || 9999;
  const verso = Boolean(folhaMatch?.[2]) || /\bverso\b/i.test(texto.slice(0, 250));
  const qualidade = avaliarQualidadeOcr(textoBruto);
  return {
    nome,
    matricula: matricula ? formatarNumeroMatricula(matricula) : null,
    folha: folha ? `${formatarNumeroMatricula(folha)}${verso ? "V" : ""}` : null,
    ordem: numeroFolha * 2 + (verso ? 1 : 0),
    qualidade: qualidade.score,
    alertas: qualidade.alertas,
  };
}

function normalizarData(bruto: string): string | null {
  const numerica = bruto.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (numerica) {
    return `${numerica[3]}-${numerica[2]!.padStart(2, "0")}-${numerica[1]!.padStart(2, "0")}`;
  }
  const extenso = bruto
    .toLowerCase()
    .match(/(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})/);
  if (extenso) {
    const mes = MESES[extenso[2]!];
    if (mes) return `${extenso[3]}-${mes}-${extenso[1]!.padStart(2, "0")}`;
  }
  return null;
}

/** Converte áreas em ha/alqueire/m² para metros quadrados. */
function areaParaM2(valor: string, unidade: string): number | null {
  const bruto = valor.replace(/\./g, "").replace(",", ".");
  const n = Number(bruto);
  if (!Number.isFinite(n)) return null;
  const u = unidade.toLowerCase();
  if (u.startsWith("ha") || u.includes("hectare")) return n * 10000;
  if (u.includes("alqueire")) return n * 24200;
  return n;
}

function capturar(texto: string, padroes: RegExp[]): string | null {
  for (const re of padroes) {
    const m = texto.match(re);
    if (m?.[1]) {
      const v = limpar(m[1]);
      if (v) return v;
    }
  }
  return null;
}

function extrairProprietarios(texto: string): IndexProprietario[] {
  const encontrados = new Map<string, IndexProprietario>();
  const re =
    /([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'’.\- ]{5,80}?)\s*,?\s*(?:[^.\n]{0,120}?)?\b(?:CPF|C\.P\.F\.|CNPJ|C\.N\.P\.J\.)\s*(?:n[.º°]*)?\s*[:\-]?\s*([\d.\-/]{11,18})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const doc = digitos(m[2] ?? "");
    if (doc.length !== 11 && doc.length !== 14) continue;
    const nome = limpar(m[1]);
    if (!nome || !nomeValido(nome)) continue;


    if (!encontrados.has(doc)) {
      encontrados.set(doc, { nome: nome.toUpperCase(), cpf_cnpj: formatarDoc(doc), fracao: null });
    }
  }
  return [...encontrados.values()];
}

/** Normaliza nome para comparação (sem acento, caixa alta, espaços simples). */
const chaveNome = (n: string | null | undefined): string =>
  (n ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Marca cada proprietário como ATIVO (titular atual) ou INATIVO (titular
 * anterior). Regra determinística: quem consta como transmitente/cônjuge do
 * transmitente é INATIVO; havendo adquirente identificado, só ele e seu cônjuge
 * ficam ATIVO. Sem partes identificadas, todos permanecem ATIVO.
 */
function aplicarSituacaoProprietarios(
  props: IndexProprietario[],
  partes: { adquirente: string | null; conjuge_adq: string | null; transmitente: string | null; conjuge_transm: string | null },
): IndexProprietario[] {
  const atuais = [partes.adquirente, partes.conjuge_adq].map(chaveNome).filter(Boolean);
  const anteriores = [partes.transmitente, partes.conjuge_transm].map(chaveNome).filter(Boolean);
  return props.map((p) => {
    const k = chaveNome(p.nome);
    let situacao: "ATIVO" | "INATIVO" = "ATIVO";
    if (k && anteriores.some((a) => a === k || a.includes(k) || k.includes(a))) situacao = "INATIVO";
    else if (k && atuais.length && !atuais.some((a) => a === k || a.includes(k) || k.includes(a)))
      situacao = "INATIVO";
    return { ...p, situacao };
  });
}


export function formatarDoc(doc: string): string {
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

const ONUS_TERMOS = [
  "hipoteca", "penhora", "arresto", "usufruto", "servidão", "alienação fiduciária",
  "indisponibilidade", "arrolamento", "cláusula de inalienabilidade", "cláusula de impenhorabilidade",
  "bem de família", "reserva legal", "citação", "protesto", "compromisso de compra e venda",
];

/** Linguagem padronizada de baixa/cancelamento averbada nas matrículas. */
const CANCELAMENTO_TERMOS = [
  "cancel", // cancelo, cancelada, cancelamento
  "baixa d", "baixa da", "baixa do", "dou baixa", "procedo à baixa", "procedo a baixa",
  "extin", // extinção, extinto o usufruto
  "levantamento", "liberação", "liberacao", "libero", "remissão", "remissao",
  "insubsist", "sem efeito", "nada consta", "quitação da dívida", "quitacao da divida",
];

const ehCancelamento = (t: string): boolean => {
  const s = t.toLowerCase();
  return CANCELAMENTO_TERMOS.some((c) => s.includes(c));
};

/** Referências a atos anteriores citadas no corpo da averbação (R.04, AV.07…). */
function referenciasInternas(descricao: string): string[] {
  return [...descricao.matchAll(/\b(R|AV|Av|R\.|AV\.)\s*[-.\s]?\s*(\d{1,3}(?:\.\d{3})+|\d+)\b/g)]
    .map((m) => {
      const tipo = (m[1] ?? "").toUpperCase().startsWith("A") ? "AV" : "R";
      return rotuloAto(tipo, m[2] ?? "");
    })
    .slice(1); // o primeiro marcador é o próprio número do ato
}

/** Gravame identificado no texto do ato (hipoteca, penhora…). */
function gravameDe(descricao: string): string | null {
  const s = descricao.toLowerCase();
  return ONUS_TERMOS.find((t) => s.includes(t)) ?? null;
}

/**
 * Marca cada ônus como vigente ou cancelado. O cancelamento é ligado ao ato de
 * origem pela referência interna ("cancelo o R.04"); sem referência explícita,
 * casa-se pelo mesmo tipo de gravame ainda vigente mais recente.
 */
function aplicarVigencia(atos: IndexAto[]): { onus: IndexAto[]; onusCancelados: IndexAto[] } {
  const onus = atos
    .filter((a) => !ehCancelamento(a.descricao) && gravameDe(a.descricao))
    .map<IndexAto>((a) => ({
      ...a,
      gravame: gravameDe(a.descricao),
      vigente: true,
      cancelado_por: null,
    }));

  const chave = (a: IndexAto) => rotuloAto(a.tipo, a.numero);

  for (const ato of atos) {
    if (!ehCancelamento(ato.descricao)) continue;
    const refs = referenciasInternas(ato.descricao);
    const alvos = onus.filter((o) => refs.includes(chave(o)));
    if (alvos.length) {
      for (const alvo of alvos) {
        alvo.vigente = false;
        alvo.cancelado_por = chave(ato);
      }
      continue;
    }
    const grav = gravameDe(ato.descricao);
    if (!grav) continue;
    const candidatos = onus.filter((o) => o.vigente !== false && o.gravame === grav);
    const alvo = candidatos.length ? candidatos[candidatos.length - 1] : null;
    if (alvo) {
      alvo.vigente = false;
      alvo.cancelado_por = chave(ato);
    }
  }

  return {
    onus: onus.filter((o) => o.vigente !== false),
    onusCancelados: onus.filter((o) => o.vigente === false),
  };
}

/** Localiza os atos (R.01, AV.02, AV.03…) e classifica os que representam ônus. */
function extrairAtos(texto: string): { atos: IndexAto[]; onus: IndexAto[]; onusCancelados: IndexAto[] } {
  const atos: IndexAto[] = [];
  // O separador final distingue o cabeçalho do ato ("Av.27/M.1:") de
  // referências no corpo ("características mencionadas na Av. 25").
  const marcador = /\b(R|AV)\s*[.\-/]?\s*(\d{1,3}(?:\.\d{3})+|\d+)\s*(?:[.\-/]\s*M\s*[.\-]?\s*\d+)?\s*[:=]/gi;
  const posicoes: { idx: number; tipo: string; numero: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = marcador.exec(texto))) {
    const tipo = (m[1] ?? "").toUpperCase().startsWith("A") ? "AV" : "R";
    posicoes.push({ idx: m.index, tipo, numero: String(m[2] ?? "") });
  }
  for (let i = 0; i < posicoes.length; i++) {
    const inicio = posicoes[i]!.idx;
    const fim = i + 1 < posicoes.length ? posicoes[i + 1]!.idx : Math.min(texto.length, inicio + 1200);
    const trecho = texto.slice(inicio, fim).replace(/\s+/g, " ").trim();
    if (trecho.length < 20) continue;
    atos.push({
      tipo: posicoes[i]!.tipo,
      numero: formatarNumeroMatricula(posicoes[i]!.numero),
      data: normalizarData(trecho),
      descricao: trecho.slice(0, 600),
    });
  }
  return { atos, ...aplicarVigencia(atos) };
}

/**
 * Ônus e direitos reais registrados na matrícula (vigentes e cancelados),
 * na ordem em que aparecem no documento. Usado pelo CheckIndex e, no
 * CheckTítulo, quando o documento conferido for uma matrícula.
 */
export function extrairOnusMatricula(textoBruto: string): IndexAto[] {
  const texto = (textoBruto ?? "").replace(/\r/g, "");
  if (!texto.trim()) return [];
  const { onus, onusCancelados } = extrairAtos(texto);
  const ordem = (a: IndexAto) => `${a.tipo ?? ""}${String(a.numero ?? "").padStart(6, "0")}`;
  return [...onus, ...onusCancelados].sort((a, b) => ordem(a).localeCompare(ordem(b)));
}



export function extrairIndiceMatricula(textoBruto: string): MatriculaIndexada {
  const texto = normalizarTextoRegistral(textoBruto);
  const compacto = texto.replace(/\s+/g, " ");

  const auxiliar = /registro\s+auxiliar/i.test(compacto);
  const numeroLivro = capturar(compacto, [
    /(?:matr[ií]cula|registro\s+auxiliar)\s*(?:n[.º°]*)?\s*[:\-]?\s*([\d.]{1,12})/i,
    /\bMAT\.?\s*(?:n[.º°]*)?\s*([\d.]{1,12})/i,
    /livro\s*(?:n[.º°]*)?\s*[:\-]?\s*([\d.]{1,12})/i,
  ]);
  const matriculasEmAtos = [...compacto.matchAll(/\b(?:R|AV)\s*[.\-/]?\s*\d+\s*[.\-/]\s*M\s*[.\-]?\s*(\d{1,3}(?:\.\d{3})*|\d+)\s*[:=]/gi)]
    .map((m) => m[1] ?? "")
    .filter(Boolean);
  const matriculaPredominante = matriculasEmAtos.length
    ? [...new Set(matriculasEmAtos)].sort((a, b) => matriculasEmAtos.filter((v) => v === b).length - matriculasEmAtos.filter((v) => v === a).length)[0]
    : null;
  const livro = numeroLivro
    ? formatarNumeroMatricula(numeroLivro)
    : matriculaPredominante
      ? formatarNumeroMatricula(matriculaPredominante)
      : null;

  const cns = capturar(compacto, [
    /\b(\d{6}\.\d\.\d{7}-\d{2})\b/,
    /\bCNS\s*(?:n[.º°]*)?\s*[:\-]?\s*([\d.\-]{10,24})/i,
  ]);

  const dataBruta =
    compacto.match(/(?:aberta?|aberta em|em)\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i)?.[1] ??
    compacto.match(/(\d{1,2}\s+de\s+[a-zA-ZçÇãÃ]+\s+de\s+\d{4})/)?.[1] ??
    "";
  const dataAbertura = dataBruta ? normalizarData(dataBruta) : null;

  const ruralIndicios = /(?:im[óo]vel rural|s[íi]tio|fazenda|ch[áa]cara|gleba|ccir|incra|sigef|matr[íi]cula rural)/i;
  const urbanoIndicios = /(?:lote|quadra|apartamento|casa|im[óo]vel urbano|loteamento|rua|avenida)/i;
  const natureza: MatriculaIndexada["natureza"] = ruralIndicios.test(compacto)
    ? "rural"
    : urbanoIndicios.test(compacto)
      ? "urbano"
      : "nao_identificado";

  const areaMatches = [...compacto.matchAll(
    /[áa]rea(?:\s+total(?:\s*\/\s*registrada)?|\s+registrada|\s+do\s+terreno|\s+superficial)?\s*(?:de|:)?\s*([\d.]+,\d+|[\d.]+)\s*(m²|m2|metros quadrados|ha|hectares?|alqueires?)/gi,
  )];
  const areaMatch = areaMatches.at(-1) ?? null;
  const areaM2 = areaMatch ? areaParaM2(areaMatch[1] ?? "", areaMatch[2] ?? "m2") : null;

  const enderecoTitular =
    capturar(compacto, [
      /(?:residente\s+e\s+domiciliad[oa]s?\s+(?:na|no|em)|domiciliad[oa]s?\s+(?:na|no|em)|endere[çc]o\s*[:\-]?)\s*([^;.]{8,160})/i,
      /((?:rua|avenida|av\.|travessa|alameda|estrada|rodovia|pra[çc]a)[^;.]{5,140})/i,
    ]) ?? "";

  const ultimaCaptura = (padrao: RegExp): string | null => {
    const encontrados = [...compacto.matchAll(padrao)];
    return limpar(encontrados.at(-1)?.[1]);
  };
  const cadastros: IndexCadastros = {
    // Matrículas antigas trazem "NIRF"; o cadastro atual é o CIB.
    cib: ultimaCaptura(/\b(?:CIB|NIRF)\b\s*(?:n[.º°]*)?\s*[:\-]?\s*([\w.\-/]{4,30})/gi),
    cim: capturar(compacto, [
      /(?:CIM|cadastro\s+imobili[áa]rio\s+municipal|cadastro municipal|inscri[çc][ãa]o (?:imobili[áa]ria|municipal)|IPTU)\s*(?:n[.º°]*)?\s*[:\-]?\s*([\w.\-/]{3,40})/i,
    ]),
    ccir: ultimaCaptura(/\bCCIR\b\s*(?:n[.º°]*)?\s*[:\-]?\s*([\w.\-/]{4,40})/gi),
    car: ultimaCaptura(/\b(?:CAR|SICAR)\b\s*(?:sob\s*(?:o\s*)?)?(?:n[.º°]*)?\s*[:\-]?\s*([\w.\-/]{6,60})/gi),
  };

  const descricaoMatch = compacto.match(
    /(?:im[óo]vel|descri[çc][ãa]o)\s*[:\-]?\s*([^]{40,900}?)(?:propriet[áa]ri|registro anterior|R\.01|AV\.01|$)/i,
  );

  const { atos, onus, onusCancelados } = extrairAtos(texto);
  const partes = extrairPartes(compacto);
  const ultimoAto = atos.length ? atos[atos.length - 1]! : null;
  const evidencias = criarEvidencias(compacto, {
    livro,
    ultima_ficha: extrairUltimaFicha(compacto),
    ultimo_ato: ultimoAto?.numero ?? null,
    area_hectare: extrairHectares(compacto, areaM2),
    cib: cadastros.cib,
    car: cadastros.car,
  }, ultimoAto);

  return {
    tipo_livro: auxiliar ? 3 : 2,
    livro,
    matricula_numero: livro,
    cns,
    data_abertura: dataAbertura,
    ultima_ficha: extrairUltimaFicha(compacto),
    // Apenas o número sequencial do ato (vale para R e Av).
    ultimo_ato: ultimoAto?.numero ?? null,
    registro_anterior: auxiliar ? null : extrairRegistroAnterior(compacto),
    encerrada: ENCERRAMENTO.test(compacto),
    matriculas_abertas: extrairMatriculasAbertas(compacto),
    natureza,
    ...extrairLocalizacao(compacto, enderecoTitular),
    certificacao: extrairCertificacao(compacto),
    cadastros,
    area_m2: areaM2,
    area_hectare: extrairHectares(compacto, areaM2),
    perimetro_m: extrairPerimetro(compacto),
    area_construida_m2: extrairAreaConstruida(compacto),
    descricao: limpar(descricaoMatch?.[1]) ?? "",
    prenotacao: extrairPrenotacao(compacto),
    tipo_ato: ultimoAto?.tipo ? `${ultimoAto.tipo}.` : null,
    ato: ultimoAto?.numero ?? null,
    data_ato: ultimoAto?.data ?? null,
    selo: extrairSelo(compacto),
    ...partes,
    ...extrairQualificacao(compacto),
    endereco: enderecoTitular,
    situacao_titulares: partes.adquirente || partes.transmitente ? "ATIVO" : null,
    proprietarios: aplicarSituacaoProprietarios(extrairProprietarios(compacto), partes),
    atos,
    onus,
    onus_cancelados: onusCancelados,
    evidencias,
  };
}

/** Estado civil, regime de bens, contatos e identificação do titular. */
function extrairQualificacao(texto: string) {
  const estados = ["solteiro", "casado", "separado", "divorciado", "viúvo", "viuvo"] as const;
  const achado = estados.find((e) => new RegExp(`\\b${e}[oa]?s?\\b`, "i").test(texto));
  const estadoCivil = achado ? (achado === "viuvo" ? "viúvo" : achado) : null;

  const regimes: [RegExp, string][] = [
    [/comunh[ãa]o\s+universal/i, "comunhão universal"],
    [/comunh[ãa]o\s+parcial/i, "comunhão parcial"],
    [/separa[çc][ãa]o\s+obrigat[óo]ria/i, "separação obrigatória"],
    [/separa[çc][ãa]o\s+(?:absoluta|total|convencional)/i, "separação absoluta"],
    [/participa[çc][ãa]o\s+final\s+nos\s+aquestos/i, "participação final nos aquestos"],
    [/regime\s+misto/i, "regime misto"],
  ];
  const regBens = regimes.find(([re]) => re.test(texto))?.[1] ?? null;

  const dataCasamento = (() => {
    const j = texto.match(/casad[oa][^.;]{0,120}?(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i)?.[1];
    return j ? normalizarData(j) : null;
  })();

  const leiCasamento = dataCasamento
    ? dataCasamento < "1977-12-27"
      ? "antes da Lei 6.515/77"
      : "depois da Lei 6.515/77"
    : null;

  const pacto = capturar(texto, [
    /pacto\s+antenupcial[^.;]{0,160}/i,
  ]);

  const email = capturar(texto, [/\b([\w.\-+]+@[\w.\-]+\.[A-Za-z]{2,})\b/]);
  const telefone = capturar(texto, [
    /(?:telefone|fone|celular|tel\.?)\s*[:\-]?\s*(\(?\d{2}\)?\s?\d{4,5}-?\d{4})/i,
  ]);
  const identificacao = capturar(texto, [
    /\b(?:CPF|C\.P\.F\.|CNPJ|C\.N\.P\.J\.)\b\s*(?:n[.º°]*)?\s*[:\-]?\s*([\d.\-/]{11,18})/i,
  ]);
  const inscricaoEstadual = capturar(texto, [
    /(?:inscri[çc][ãa]o estadual|NIRE|RCPJ)\s*(?:n[.º°]*)?\s*[:\-]?\s*([\w.\-/]{4,30})/i,
  ]);

  return {
    estado_civil: estadoCivil,
    data_casamento: dataCasamento,
    lei_casamento: leiCasamento,
    reg_bens: regBens,
    pacto,
    email,
    telefone,
    identificacao,
    inscricao_estadual: inscricaoEstadual,
  };
}


/** Nome próprio logo após um rótulo de parte (adquirente, transmitente…). */
function nomeApos(texto: string, rotulos: string[]): string | null {
  for (const rot of rotulos) {
    const m = texto.match(
      new RegExp(`${rot}\\s*(?:\\(a\\))?\\s*[:\\-]?\\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'’.\\- ]{5,80})`, "i"),
    );
    const v = limpar(m?.[1]);
    if (v && nomeValido(v)) return v.toUpperCase();
  }
  return null;
}

/** Cônjuge citado na sequência do nome da parte ("casado com FULANA"). */
function conjugeDe(texto: string, nome: string | null): string | null {
  if (!nome) return null;
  const idx = texto.toUpperCase().indexOf(nome);
  if (idx < 0) return null;
  const janela = texto.slice(idx, idx + 400);
  const m = janela.match(
    /(?:casad[oa]\s+(?:com|de)|c[ôo]njuge|e\s+sua\s+(?:esposa|mulher)|e\s+seu\s+marido)\s*[:\-]?\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'’.\- ]{5,80})/i,
  );
  const v = limpar(m?.[1]);
  return v && nomeValido(v) ? v.toUpperCase() : null;
}


function extrairPartes(texto: string) {
  const adquirente = nomeApos(texto, [
    "adquirente",
    "comprador(?:a)?",
    "outorgad[oa] comprador(?:a)?",
    "cession[áa]ri[oa]",
  ]);
  const transmitente = nomeApos(texto, [
    "transmitente",
    "vendedor(?:a)?",
    "outorgante vendedor(?:a)?",
    "cedente",
  ]);
  const usufrutuario = nomeApos(texto, ["usufrutu[áa]ri[oa]", "usufruto\\s+em\\s+favor\\s+de"]);
  const outorgante = nomeApos(texto, ["outorgante"]);
  const outorgado = nomeApos(texto, ["outorgad[oa]"]);
  return {
    adquirente,
    conjuge_adq: conjugeDe(texto, adquirente),
    transmitente,
    conjuge_transm: conjugeDe(texto, transmitente),
    usufrutuario,
    conjuge_usu: conjugeDe(texto, usufrutuario),
    outorgante,
    conjuge_outorgante: conjugeDe(texto, outorgante),
    outorgado,
    conjuge_outorgado: conjugeDe(texto, outorgado),
    credor: nomeApos(texto, ["credor(?:a)?", "credor(?:a)?\\s+hipotec[áa]ri[oa]", "credor(?:a)?\\s+fiduci[áa]ri[oa]"]),
    devedor: nomeApos(texto, ["devedor(?:a)?", "devedor(?:a)?\\s+fiduciante", "fiduciante"]),
    serviente: nomeApos(texto, ["serviente", "pr[ée]dio\\s+serviente", "im[óo]vel\\s+serviente"]),
    dominante: nomeApos(texto, ["dominante", "pr[ée]dio\\s+dominante", "im[óo]vel\\s+dominante"]),
  };
}


function extrairPrenotacao(texto: string): string | null {
  return capturar(texto, [
    /(?:prenota[çc][ãa]o|protocolo)\s*(?:sob\s*(?:o\s*)?)?(?:n[.º°]*)?\s*[:\-]?\s*([\d.\-/]{2,20})/i,
  ]);
}

function extrairSelo(texto: string): string | null {
  return capturar(texto, [
    /selo\s*(?:digital|de\s+fiscaliza[çc][ãa]o)?\s*(?:n[.º°]*)?\s*[:\-]?\s*([A-Z0-9.\-]{6,40})/i,
  ]);
}

/** Rótulo do ato com separador de milhar (R.1, AV.2.058). */
export function rotuloAto(tipo: string | null | undefined, numero: string | number | null | undefined): string {
  const n = numero === null || numero === undefined ? "" : String(numero);
  const t = tipo ?? "";
  return n ? `${t}.${formatarNumeroMatricula(n)}` : t;
}

/** Formata número de matrícula com separador de milhar (10345 -> 10.345). */
export function formatarNumeroMatricula(valor: string): string {
  const d = digitos(valor);
  if (!d) return valor.trim();
  return String(Number(d)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const ENCERRAMENTO = /\bencerrad[ao]\b/i;

function extrairUltimaFicha(texto: string): string | null {
  const fichas = [...texto.matchAll(/(?:[úu]ltima\s+)?(?:ficha|folha)\s*(?:n[.º°]*)?\s*[:\-]?\s*(\d{1,4})\s*(v(?:erso)?|vº)?\b/gi)]
    .map((m) => ({ numero: Number(m[1]), verso: Boolean(m[2]) }))
    .filter((f) => Number.isFinite(f.numero));
  const ultima = fichas.sort((a, b) => a.numero - b.numero || Number(a.verso) - Number(b.verso)).at(-1);
  return ultima ? `${ultima.numero}${ultima.verso ? "V" : ""}` : null;
}

function extrairCertificacao(texto: string): string | null {
  return capturar(texto, [
    /certifica[çc][ãa]o\s*(?:do\s*)?(?:INCRA|SIGEF)?\s*(?:sob\s*(?:o\s*)?)?(?:n[.º°]*)?\s*[:\-]?\s*([\w.\-/]{6,60})/i,
    /c[óo]digo\s+(?:da\s+)?certifica[çc][ãa]o\s*[:\-]?\s*([\w.\-/]{6,60})/i,
  ]);
}

/** Monta o ato de origem no padrão R.05/M.5.456, AV.08/M.1.234 ou TR.7.908/L3.-Q. */
function extrairRegistroAnterior(texto: string): string | null {
  const janela =
    texto.match(/registro\s+anterior[^]{0,200}/i)?.[0] ??
    texto.match(/(?:oriund[ao]|proveniente|desmembrad[ao])\s+d[ae][^]{0,200}/i)?.[0] ??
    "";
  if (!janela) return null;

  const ato = janela.match(/\b(R|AV|TR)\b[.\-\s]*\s*(\d{1,3}(?:\.\d{3})+|\d{1,9})/i);
  const origem =
    janela.match(/\b(?:matr[íi]cula|M)\b[.\s]*(?:n[.º°]*)?\s*([\d.]{1,12})/i) ??
    janela.match(/\btranscri[çc][ãa]o\b[.\s]*(?:n[.º°]*)?\s*([\d.]{1,12})/i);
  if (!ato && !origem) return null;

  const tipo = (ato?.[1] ?? "R").toUpperCase();
  const numeroAto = ato?.[2] ? formatarNumeroMatricula(ato[2]) : "";
  const alvo = origem?.[1] ? `M.${formatarNumeroMatricula(origem[1])}` : "";
  const esquerda = numeroAto ? `${tipo}.${numeroAto}` : tipo;
  return alvo ? `${esquerda}/${alvo}` : esquerda;
}

function extrairMatriculasAbertas(texto: string): string[] {
  if (!ENCERRAMENTO.test(texto)) return [];
  const indice = texto.search(ENCERRAMENTO);
  const janela = indice >= 0 ? texto.slice(Math.max(0, indice - 380), indice + 380) : "";
  const numeros = [...janela.matchAll(/matr[ií]cula\s*(?:n[.º°]*)?\s*([\d]{1,3}(?:\.\d{3})+|\d{3,8})\b/gi)].map((m) =>
    formatarNumeroMatricula(m[1] ?? ""),
  );
  return [...new Set(numeros)];
}

function criarEvidencias(
  texto: string,
  valores: Record<string, string | number | null>,
  ultimoAto: IndexAto | null,
): Record<string, IndexEvidencia> {
  const saida: Record<string, IndexEvidencia> = {};
  for (const [campo, valor] of Object.entries(valores)) {
    if (valor === null || valor === "") continue;
    const literal = String(valor);
    const candidatos = [literal, literal.replace(/\./g, ""), literal.replace(".", ",")];
    let indice = -1;
    for (const candidato of candidatos) {
      indice = texto.toLowerCase().lastIndexOf(candidato.toLowerCase());
      if (indice >= 0) break;
    }
    const trecho = indice >= 0
      ? texto.slice(Math.max(0, indice - 90), Math.min(texto.length, indice + literal.length + 130)).trim()
      : "Valor inferido pela leitura da matrícula; confirme no documento.";
    saida[campo] = {
      ato: campo === "ultimo_ato" && ultimoAto ? rotuloAto(ultimoAto.tipo, ultimoAto.numero) : null,
      trecho,
      confianca: indice >= 0 ? "alta" : "baixa",
    };
  }
  return saida;
}


/** Campos exibidos na revisão e exportados na ordem do layout padrão. */
export const CAMPOS_INDICE: { chave: keyof MatriculaIndexada; rotulo: string }[] = [
  { chave: "tipo_livro", rotulo: "Tipo de livro" },
  { chave: "livro", rotulo: "Livro" },
  { chave: "cns", rotulo: "CNS" },
  { chave: "data_abertura", rotulo: "Data de abertura" },
  { chave: "ultima_ficha", rotulo: "Última ficha" },
  { chave: "ultimo_ato", rotulo: "Último ato" },
  { chave: "registro_anterior", rotulo: "Registro anterior" },
  { chave: "natureza", rotulo: "Natureza" },
  { chave: "certificacao", rotulo: "Certificação (INCRA)" },
  { chave: "area_m2", rotulo: "Área (m²)" },
  { chave: "descricao", rotulo: "Descrição" },
];


const TIPOS_LOGRADOURO = [
  "rua","avenida","alameda","travessa","praça","praca","rodovia","estrada","via","viela",
  "largo","beco","passagem","quadra","conjunto","servidão","servidao","ladeira","marginal",
];

const TIPOS_RURAL = [
  "fazenda","sítio","sitio","chácara","chacara","gleba","lote rural","sesmaria","estância",
  "estancia","haras","granja","colônia","colonia","quinhão","quinhao","retiro","povoado",
];

/**
 * Decompõe a identificação urbana (CEP, logradouro, bairro, lote/quadra,
 * condomínio, unidade, andar e bloco) e a identificação rural.
 */
function extrairLocalizacao(compacto: string, endereco: string) {
  const base = `${endereco} ${compacto}`;

  const cep = capturar(base, [/\bCEP\s*[:\-]?\s*(\d{5}-?\d{3})\b/i, /\b(\d{5}-\d{3})\b/]);

  const alt = TIPOS_LOGRADOURO.map((t) => t.replace(/ /g, "\\s+")).join("|");
  const mLog = base.match(
    new RegExp(`\\b(${alt})\\b\\s+((?:[A-Za-zÀ-ÿ0-9'’.\\-]+\\s*){1,8}?)(?=,|\\s+n[.º°]|\\s+nº|\\s+número|$)`, "i"),
  );
  const tipoLogradouro = mLog?.[1] ? limpar(mLog[1])!.toUpperCase() : null;
  const logradouro = mLog?.[2] ? limpar(mLog[2])?.toUpperCase() ?? null : null;

  const numeroLogradouro =
    capturar(base, [
      /\b(?:n[.º°]{1,2}|n[uú]mero|nº)\s*[:\-]?\s*(\d{1,6}\s*[A-Za-z]?)\b/i,
      /,\s*(\d{1,6})\s*(?:,|-|$)/,
    ])?.replace(/\s+/g, "").toUpperCase() ?? null;

  const bairro =
    capturar(base, [
      /\bbairro\s*(?:de|do|da)?\s*[:\-]?\s*([A-Za-zÀ-ÿ0-9'’.\- ]{3,60})/i,
    ])?.toUpperCase() ?? null;

  const lote = capturar(base, [/\blote\s*(?:n[.º°]*)?\s*[:\-]?\s*([A-Z0-9\-/]{1,10})\b/i])?.toUpperCase() ?? null;
  const quadra = capturar(base, [/\bquadra\s*(?:n[.º°]*)?\s*[:\-]?\s*([A-Z0-9\-/]{1,10})\b/i])?.toUpperCase() ?? null;

  const condominio =
    capturar(base, [
      /\b(?:cond[oô]m[íi]nio|edif[íi]cio|residencial)\s*(?:denominad[oa]\s*)?["'“]?([A-Za-zÀ-ÿ0-9'’.\- ]{3,60})/i,
    ])?.toUpperCase() ?? null;
  const unidade =
    capturar(base, [
      /\b(?:unidade(?:\s+aut[ôo]noma)?|apartamento|apto\.?|sala|loja|box|vaga)\s*(?:n[.º°]*)?\s*[:\-]?\s*([A-Z0-9\-/]{1,10})\b/i,
    ])?.toUpperCase() ?? null;
  const andar =
    capturar(base, [
      /\b(\d{1,3}[ºo°]?)\s*(?:andar|pavimento)\b/i,
      /\b(?:andar|pavimento)\s*[:\-]?\s*([A-Z0-9\-º°]{1,6})\b/i,
    ])?.toUpperCase() ?? null;
  const bloco =
    capturar(base, [/\b(?:bloco|torre)\s*[:\-]?\s*([A-Z0-9\-]{1,6})\b/i])?.toUpperCase() ?? null;

  const altR = TIPOS_RURAL.map((t) => t.replace(/ /g, "\\s+")).join("|");
  const mRural = base.match(
    new RegExp(`\\b(${altR})\\b\\s*(?:denominad[oa]\\s*)?["'“]?((?:[A-Za-zÀ-ÿ0-9'’.\\-]+\\s*){1,6}?)(?=["'”,.;]|\\s+(?:situad|localizad|com\\s+[áa]rea|de\\s+propriedade)|$)`, "i"),
  );
  const tipoRural = mRural?.[1] ? limpar(mRural[1])!.toUpperCase() : null;
  const denominacaoRural = mRural?.[2] ? limpar(mRural[2])?.toUpperCase() ?? null : null;

  return {
    cep: cep ? cep.replace(/^(\d{5})-?(\d{3})$/, "$1-$2") : null,
    tipo_logradouro: tipoLogradouro,
    logradouro,
    numero_logradouro: numeroLogradouro,
    bairro,
    lote,
    quadra,
    condominio,
    unidade,
    andar,
    bloco,
    tipo_rural: tipoRural,
    denominacao_rural: denominacaoRural,
  };
}


const numeroBr = (v: string | undefined | null): number | null => {
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Área em hectares: literal do documento; senão convertida da área em m². */
function extrairHectares(texto: string, areaM2: number | null): number | null {
  const m = texto.match(
    /[áa]rea[^.;\n]{0,40}?([\d.]+,\d+|[\d.]+)\s*(?:ha\b|hectares?)/i,
  );
  const lit = numeroBr(m?.[1]);
  if (lit !== null) return lit;
  return areaM2 !== null ? Number((areaM2 / 10000).toFixed(4)) : null;
}

/** Perímetro em metros (converte km quando necessário). */
function extrairPerimetro(texto: string): number | null {
  const m = texto.match(
    /per[íi]metro[^.;\n]{0,30}?([\d.]+,\d+|[\d.]+)\s*(m\b|metros|km\b|quil[ôo]metros)?/i,
  );
  const n = numeroBr(m?.[1]);
  if (n === null) return null;
  const u = (m?.[2] ?? "m").toLowerCase();
  return u.startsWith("km") || u.startsWith("quil") ? n * 1000 : n;
}

/** Área construída/edificada em m². */
function extrairAreaConstruida(texto: string): number | null {
  const m = texto.match(
    /[áa]rea\s+(?:constru[íi]da|edificada|de\s+constru[çc][ãa]o)[^.;\n]{0,25}?([\d.]+,\d+|[\d.]+)\s*(m²|m2|metros quadrados)?/i,
  );
  return numeroBr(m?.[1]);
}
