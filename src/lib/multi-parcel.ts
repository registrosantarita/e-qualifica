import { parseMemorial, parseNumber, type ParsedParcel } from "./memorial-parser";
import { parseGeometryPolygons, parseGeometryText } from "./geo-parser";
import { pareceLoteamento, parseLoteamento } from "./loteamento-parser";

/**
 * Plantas exportadas de CAD em PDF produzem texto solto (rótulos de grade,
 * cotas isoladas, legendas), sem descrição perimétrica. Interpretar esse
 * conteúdo como memorial gera polígonos inexistentes e dezenas de
 * divergências falsas — por isso o texto é recusado antes do parsing.
 */
export function semDescricaoPerimetrica(texto: string): boolean {
  const linhas = texto.split("\n").filter((l) => l.trim().length > 0);
  if (linhas.length === 0) return true;
  const mediaPalavras =
    linhas.reduce((acc, l) => acc + l.trim().split(/\s+/).length, 0) / linhas.length;
  const marcadores =
    (texto.match(/confront/gi) ?? []).length +
    (texto.match(/at[ée]\s+o\s+(?:v[ée]rtice|ponto)/gi) ?? []).length +
    (texto.match(/azimute/gi) ?? []).length +
    (texto.match(/mem(?:orial)?\s+descritiv/gi) ?? []).length;
  return marcadores < 3 && mediaPalavras < 4;
}


/**
 * Cabeçalhos que costumam iniciar a descrição de um novo polígono dentro do
 * MESMO documento (memorial de vários imóveis, planta com várias glebas,
 * desmembramento com área remanescente etc.).
 */
const CABECALHO_RE =
  /^[^\S\n]*(?:mem(?:orial)?\s*descritiv[oa]|descri[çc][ãa]o\s+do\s+per[íi]metro|im[óo]vel|lote|gleba|quadra|parcela|pol[íi]gono|[áa]rea\s*(?:\d|[ivx]+\b|remanescente|desmembrada|total\s+do\s+lote))\b[^\n]{0,140}$/gim;

function blocosDeTexto(texto: string): { titulo: string | null; corpo: string }[] {
  const marcas: { index: number; titulo: string }[] = [];
  CABECALHO_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CABECALHO_RE.exec(texto)) !== null) {
    marcas.push({ index: m.index, titulo: m[0]!.trim() });
    if (m.index === CABECALHO_RE.lastIndex) CABECALHO_RE.lastIndex += 1;
  }
  if (marcas.length < 2) return [{ titulo: null, corpo: texto }];
  return marcas.map((marca, i) => ({
    titulo: marca.titulo.slice(0, 120),
    corpo: texto.slice(marca.index, marcas[i + 1]?.index ?? texto.length),
  }));
}

function assinatura(p: ParsedParcel): string {
  return p.segments
    .map((s) => `${s.distance_m ?? ""}|${s.azimuth_deg ?? ""}`)
    .join(";");
}

/** Descrições dentro de contratos não começam necessariamente em uma linha de título.
 * O início da poligonal e o fecho delimitam o texto útil; cláusulas vizinhas não
 * devem emprestar área, matrícula ou segmentos a outro imóvel. */
export function descricoesEmProsa(texto: string): { parcela: ParsedParcel; texto: string }[] {
  const inicios = [...texto.matchAll(/\ba\s+poligonal\s+inicia\s+no\s+ponto\s+[\w.-]+\s*,/gi)];
  if (!inicios.length) return [];
  const candidatos = new Map<string, { parcela: ParsedParcel; texto: string; ordem: number }>();
  inicios.forEach((inicio, ordem) => {
    const pos = inicio.index;
    const proximo = inicios[ordem + 1]?.index ?? texto.length;
    const resto = texto.slice(pos, Math.min(proximo, pos + 40000));
    const fecho = /onde\s+teve\s+in[ií]cio\s+a\s+descri[çc][ãa]o\s+deste\s+per[ií]metro/i.exec(resto);
    const corpo = fecho ? resto.slice(0, fecho.index + fecho[0].length) : resto;
    const contexto = texto.slice(Math.max(0, pos - 320), pos);
    const area = [...contexto.matchAll(/[áa]rea(?:\s+de\s+servid[ãa]o)?\s*:\s*[\d.,]+\s*(?:ha|m[²2])/gi)].at(-1)?.[0] ?? "";
    const referencia = [...contexto.matchAll(/\bRPR[_-]POF[_-]0?97[_-][A-Z](?:[_-][A-Z])?/gi)].at(-1)?.[0] ?? "";
    const faixa = /faixa\s+adicional/i.test(contexto.slice(-170)) ? "Faixa adicional" : "Faixa principal";
    const trecho = `${area.toLowerCase()}\n${corpo}`;
    const parcela = parseMemorial(trecho);
    const areaValor = /[\d.,]+/.exec(area)?.[0];
    if (areaValor && parcela.area_m2 === null) {
      const numero = parseNumber(areaValor);
      if (numero !== null) parcela.area_m2 = /ha\b/i.test(area) ? numero * 10000 : numero;
    }
    if (parcela.segments.length < 3) return;
    const coordenadaInicial = /latitude\s*:\s*([^\s,]+(?:,[\d]+)?)[\s\S]{0,65}?longitude\s*:\s*([^\s,]+(?:,[\d]+)?)/i.exec(corpo.slice(0, 250));
    const chave = coordenadaInicial
      ? `${coordenadaInicial[1]?.replace(/\s/g, "").replace(/^-/, "")}|${coordenadaInicial[2]?.replace(/\s/g, "").replace(/^-/, "")}`
      : assinatura(parcela);
    const anterior = candidatos.get(chave);
    if (!anterior || (parcela.area_m2 !== null && anterior.parcela.area_m2 === null) ||
      (parcela.area_m2 !== null && parcela.segments.length > anterior.parcela.segments.length)) {
      candidatos.set(chave, {
        ordem: anterior?.ordem ?? ordem,
        texto: trecho,
        parcela: {
          ...parcela,
          label: `${faixa}${referencia ? ` — ${referencia}` : ` ${ordem + 1}`}`,
          warnings: fecho ? parcela.warnings : ["Fechamento da descrição não identificado; confira o último trecho.", ...parcela.warnings],
        },
      });
    }
  });
  return [...candidatos.values()].sort((a, b) => a.ordem - b.ordem).map(({ parcela, texto }) => ({ parcela, texto }));
}

/**
 * Extrai TODAS as parcelas (polígonos) descritas em um documento. Quando o
 * documento traz um único imóvel, devolve uma só parcela — comportamento
 * idêntico ao anterior.
 */
export function parseParcelas(text: string, ehGeometria: boolean): ParsedParcel[] {
  if (ehGeometria) {
    const poligonos = parseGeometryPolygons(text);
    if (poligonos.length > 1) {
      return poligonos.map((p, i) => ({
        ...p,
        label: p.label ?? `Polígono ${i + 1}`,
        warnings: [
          `Arquivo com ${poligonos.length} polígonos: cada um foi registrado como um imóvel independente.`,
          ...p.warnings,
        ],
      }));
    }
    const unico = parseGeometryText(text);
    return unico ? [unico] : [];
  }

  if (semDescricaoPerimetrica(text)) return [];

  const emProsa = descricoesEmProsa(text);
  if (emProsa.length) return emProsa.map((item) => item.parcela);

  if (pareceLoteamento(text)) {
    const lotes = parseLoteamento(text);
    if (lotes.length > 1) {
      return lotes.map((p) => ({
        ...p,
        warnings: [
          `Memorial de loteamento com ${lotes.length} descrições perimétricas (lotes e áreas públicas): cada uma foi registrada como um imóvel independente.`,
          ...p.warnings,
        ],
      }));
    }
  }

  const blocos = blocosDeTexto(text);

  if (blocos.length > 1) {
    const parcelas: ParsedParcel[] = [];
    const vistos = new Set<string>();
    blocos.forEach((bloco) => {
      const parsed = parseMemorial(bloco.corpo);
      if (parsed.segments.length < 3) return;
      const chave = assinatura(parsed);
      if (vistos.has(chave)) return;
      vistos.add(chave);
      parcelas.push({
        ...parsed,
        label: parsed.label ?? bloco.titulo,
      });
    });
    if (parcelas.length > 1) {
      return parcelas.map((p, i) => ({
        ...p,
        label: p.label ?? `Polígono ${i + 1}`,
        warnings: [
          `Documento com ${parcelas.length} descrições perimétricas: cada uma foi registrada como um imóvel independente, permitindo conferir a divisa comum dentro do próprio documento.`,
          ...p.warnings,
        ],
      }));
    }
  }
  return [parseMemorial(text)];
}
