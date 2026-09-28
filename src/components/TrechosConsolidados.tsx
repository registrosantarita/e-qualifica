import { Check, Minus, X } from "lucide-react";
import { fmtMedida, anguloLiteral, coordToDms, docColor, docLetra } from "@/lib/labels";
import type { TrechoConferido } from "@/lib/comparison-engine";
import { agruparConfrontantes, type TrechoConfrontante } from "@/lib/confrontantes";
import type { VertexCoordRow } from "@/lib/export-registral";

export type DocComparado = {
  /** Posição do documento na ordem de upload: 1 → B, 2 → C... */
  indice: number;
  nome: string;
  trechos: TrechoConferido[];
  vertices?: Map<string, VertexCoordRow> | undefined;
};

type Props = {
  docA: {
    indice: number;
    nome: string;
    vertices?: Map<string, VertexCoordRow> | undefined;
  };
  comparados: DocComparado[];
  ignorarConfrontacoes?: boolean;
};

const vname = (v: string | null | undefined): string =>
  (v ?? "").trim().replace(/[.,;]+$/, "").toUpperCase();

/** Valores empilhados: uma linha por documento, na cor de cada um. */
function Pilha({
  itens,
  align = "right",
}: {
  itens: { texto: string; cor: string }[];
  align?: "right" | "left";
}) {
  return (
    <div
      className={`flex flex-col leading-tight ${align === "right" ? "text-right" : "text-left"}`}
    >
      {itens.map((it, i) => (
        <span key={i} className={it.cor}>
          {it.texto}
        </span>
      ))}
    </div>
  );
}

function Icone({ ok, comparado }: { ok: boolean; comparado: boolean }) {
  if (!comparado)
    return <Minus className="h-4 w-4 text-muted-foreground" aria-label="Não conferido" />;
  return ok ? (
    <Check className="h-4 w-4 text-success" aria-label="Correto" />
  ) : (
    <X className="h-4 w-4 text-destructive" aria-label="Incorreto" />
  );
}

/**
 * Conferência trecho a trecho com todos os documentos (A, B, C, D...) na mesma
 * tabela: o paradigma sempre na primeira linha de cada célula e cada documento
 * comparado logo abaixo, na cor que o identifica.
 */
export function TrechosConsolidados({ docA, comparados, ignorarConfrontacoes = false }: Props) {
  if (comparados.length === 0) return null;

  const corA = docColor(docA.indice);
  const cores = comparados.map((d) => docColor(d.indice));

  // Índice por sequência do documento paradigma, para alinhar todos os docs.
  const porSeq = comparados.map((d) => {
    const m = new Map<number, TrechoConferido>();
    d.trechos.forEach((t) => {
      if (!m.has(t.seq_a)) m.set(t.seq_a, t);
    });
    return m;
  });

  const seqs = Array.from(
    new Set(comparados.flatMap((d) => d.trechos.map((t) => t.seq_a))),
  ).sort((a, b) => a - b);

  const baseDe = (seq: number): TrechoConferido | undefined => {
    for (const m of porSeq) {
      const t = m.get(seq);
      if (t) return t;
    }
    return undefined;
  };

  const coordA = (t: TrechoConferido | undefined) =>
    t ? docA.vertices?.get(vname(t.de_a)) : undefined;
  const coordB = (d: DocComparado, t: TrechoConferido | undefined) =>
    t ? d.vertices?.get(vname(t.de_b)) : undefined;

  const temGeo = seqs.some((s) => {
    const base = baseDe(s);
    const va = coordA(base);
    if (va?.lat != null || va?.lon != null) return true;
    return comparados.some((d, i) => {
      const w = coordB(d, porSeq[i]!.get(s));
      return w?.lat != null || w?.lon != null;
    });
  });
  const temPlana = seqs.some((s) => {
    const base = baseDe(s);
    const va = coordA(base);
    if (va?.north != null || va?.east != null) return true;
    return comparados.some((d, i) => {
      const w = coordB(d, porSeq[i]!.get(s));
      return w?.north != null || w?.east != null;
    });
  });

  /** Monta a pilha: valor do documento A e depois de cada comparado. */
  const pilha = (
    fnA: (t: TrechoConferido | undefined) => string,
    fnB: (d: DocComparado, t: TrechoConferido | undefined) => string,
    seq: number,
  ) => [
    { texto: fnA(baseDe(seq)), cor: corA },
    ...comparados.map((d, i) => ({
      texto: fnB(d, porSeq[i]!.get(seq)),
      cor: cores[i]!,
    })),
  ];

  const grupos: { doc: DocComparado; cor: string; g: TrechoConfrontante[] }[] =
    comparados.map((d, i) => ({
      doc: d,
      cor: cores[i]!,
      g: agruparConfrontantes(d.trechos),
    }));
  const maxGrupos = Math.max(0, ...grupos.map((x) => x.g.length));

  const extensaoTotal = seqs.reduce(
    (acc, s) => acc + (baseDe(s)?.distancia_a ?? 0),
    0,
  );

  return (
    <>
      <section className="panel mx-auto mt-8 w-fit max-w-[min(96rem,calc(100vw-3rem))] p-6 print:w-full print:max-w-none">
        <h2 className="text-lg">
          Conferência consolidada — todos os documentos
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {seqs.length} trecho(s) do paradigma,{" "}
          <span className="numeric">{fmtMedida(extensaoTotal)} m</span>. Cada
          célula traz o documento paradigma na primeira linha e cada documento
          comparado abaixo, na cor correspondente.
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <li className={corA}>
            Doc. {docLetra(docA.indice)} — {docA.nome} (paradigma)
          </li>
          {comparados.map((d, i) => (
            <li key={d.indice} className={cores[i]}>
              Doc. {docLetra(d.indice)} — {d.nome}
            </li>
          ))}
        </ul>

        <div className="mt-5 w-full overflow-x-auto">
          <table className="mx-auto w-auto border-collapse text-sm [&_td]:whitespace-nowrap [&_td]:px-2 [&_th]:whitespace-nowrap [&_th]:px-2">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="eyebrow py-2 px-2">#</th>
                <th className="eyebrow py-2 px-2">TRECHO DE</th>
                <th className="eyebrow py-2 px-2">TRECHO PARA</th>
                {temGeo && (
                  <>
                    <th className="eyebrow py-2 px-2 text-right">LONGITUDE</th>
                    <th className="eyebrow py-2 px-2 text-right">LATITUDE</th>
                  </>
                )}
                {temPlana && (
                  <>
                    <th className="eyebrow py-2 px-2 text-right">COORD. N(Y)</th>
                    <th className="eyebrow py-2 px-2 text-right">COORD. E(X)</th>
                  </>
                )}
                <th className="eyebrow py-2 px-2 text-right">ALT. (m)</th>
                <th className="eyebrow py-2 px-2 text-right">ÂNGULO</th>
                <th className="eyebrow py-2 px-2 text-right">DIST. (m)</th>
                <th className="eyebrow py-2 px-2 text-center" aria-label="Situação" />
              </tr>
            </thead>
            <tbody>
              {seqs.map((s) => {
                const base = baseDe(s);
                return (
                  <tr key={s} className="border-b border-border/60 align-top">
                    <td className="numeric py-2 px-2 text-muted-foreground">{s}</td>
                    <td className="numeric py-2 px-2">
                      <Pilha
                        align="left"
                        itens={pilha(
                          (t) => t?.de_a ?? "?",
                          (_d, t) => t?.de_b ?? "—",
                          s,
                        )}
                      />
                    </td>
                    <td className="numeric py-2 px-2">
                      <Pilha
                        align="left"
                        itens={pilha(
                          (t) => t?.ate_a ?? "?",
                          (_d, t) => t?.ate_b ?? "—",
                          s,
                        )}
                      />
                    </td>
                    {temGeo && (
                      <>
                        <td className="numeric py-2 px-2">
                          <Pilha
                            itens={pilha(
                              (t) => coordToDms(coordA(t)?.lon ?? null, "lon"),
                              (d, t) => coordToDms(coordB(d, t)?.lon ?? null, "lon"),
                              s,
                            )}
                          />
                        </td>
                        <td className="numeric py-2 px-2">
                          <Pilha
                            itens={pilha(
                              (t) => coordToDms(coordA(t)?.lat ?? null, "lat"),
                              (d, t) => coordToDms(coordB(d, t)?.lat ?? null, "lat"),
                              s,
                            )}
                          />
                        </td>
                      </>
                    )}
                    {temPlana && (
                      <>
                        <td className="numeric py-2 px-2">
                          <Pilha
                            itens={pilha(
                              (t) => fmtMedida(coordA(t)?.north ?? null),
                              (d, t) => fmtMedida(coordB(d, t)?.north ?? null),
                              s,
                            )}
                          />
                        </td>
                        <td className="numeric py-2 px-2">
                          <Pilha
                            itens={pilha(
                              (t) => fmtMedida(coordA(t)?.east ?? null),
                              (d, t) => fmtMedida(coordB(d, t)?.east ?? null),
                              s,
                            )}
                          />
                        </td>
                      </>
                    )}
                    <td className="numeric py-2 px-2">
                      <Pilha
                        itens={pilha(
                          (t) => fmtMedida(t?.cota_a ?? null),
                          (_d, t) => fmtMedida(t?.cota_b ?? null),
                          s,
                        )}
                      />
                    </td>
                    <td className="numeric py-2 px-2">
                      <Pilha
                        itens={pilha(
                          (t) =>
                            t
                              ? anguloLiteral(t.azimute_txt_a, t.azimute_a, t.azimute_txt_b)
                              : "—",
                          (_d, t) =>
                            t
                              ? anguloLiteral(t.azimute_txt_b, t.azimute_b, t.azimute_txt_a)
                              : "—",
                          s,
                        )}
                      />
                    </td>
                    <td className="numeric py-2 px-2">
                      <Pilha
                        itens={pilha(
                          (t) => fmtMedida(t?.distancia_a ?? null),
                          (_d, t) => fmtMedida(t?.distancia_b ?? null),
                          s,
                        )}
                      />
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex flex-col items-center gap-1">
                        <span className="invisible h-4" />
                        {comparados.map((d, i) => {
                          const t = porSeq[i]!.get(s);
                          return (
                            <div
                              key={d.indice}
                              className="flex items-center gap-1"
                              title={t?.problemas.join("; ")}
                            >
                              <span className={`text-[10px] ${cores[i]}`}>
                                {docLetra(d.indice)}
                              </span>
                              <Icone
                                ok={t?.ok ?? false}
                                comparado={!!t && t.comparado !== false}
                              />
                            </div>
                          );
                        })}
                        <span className="max-w-[220px] whitespace-normal text-center text-[11px] leading-snug text-muted-foreground">
                          {Array.from(
                            new Set(
                              comparados.flatMap(
                                (_d, i) => porSeq[i]!.get(s)?.problemas ?? [],
                              ),
                            ),
                          ).join("; ")}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {!ignorarConfrontacoes && maxGrupos > 0 && (
        <section className="panel mt-8 p-6">
          <h2 className="text-lg">Imóveis confrontantes — consolidado</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-auto min-w-full table-auto border-collapse text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="eyebrow py-2 pr-3">Confrontação</th>
                  <th className="eyebrow py-2 pr-3">Caminhamento</th>
                  <th className="eyebrow py-2 pr-3 text-right">Trechos</th>
                  <th className="eyebrow py-2 pr-3 text-right">Extensão (m)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxGrupos }, (_, i) => {
                  const base = grupos.find((x) => x.g[i])?.g[i];
                  if (!base) return null;
                  return (
                    <tr key={i} className="border-b border-border/60 align-top">
                      <td className="whitespace-nowrap py-2 pr-3">
                        <Pilha
                          align="left"
                          itens={[
                            { texto: base.confrontante || "—", cor: corA },
                            ...grupos.map((x) => ({
                              texto: x.g[i]?.confrontante_b || "—",
                              cor: x.cor,
                            })),
                          ]}
                        />
                      </td>
                      <td className="numeric whitespace-nowrap py-2 pr-3">
                        <Pilha
                          align="left"
                          itens={[
                            { texto: `${base.de} → ${base.ate}`, cor: corA },
                            ...grupos.map((x) => {
                              const g = x.g[i];
                              return {
                                texto:
                                  g && (g.de_b || g.ate_b)
                                    ? `${g.de_b || "?"} → ${g.ate_b || "?"}`
                                    : "—",
                                cor: x.cor,
                              };
                            }),
                          ]}
                        />
                      </td>
                      <td className="numeric whitespace-nowrap py-2 pr-3">
                        <Pilha
                          itens={[
                            { texto: String(base.trechos), cor: corA },
                            ...grupos.map((x) => ({
                              texto:
                                x.g[i] && x.g[i]!.trechos_b > 0
                                  ? String(x.g[i]!.trechos_b)
                                  : "—",
                              cor: x.cor,
                            })),
                          ]}
                        />
                      </td>
                      <td className="numeric whitespace-nowrap py-2 pr-3">
                        <Pilha
                          itens={[
                            { texto: fmtMedida(base.extensao_m), cor: corA },
                            ...grupos.map((x) => ({
                              texto:
                                x.g[i]?.extensao_b_m == null
                                  ? "—"
                                  : fmtMedida(x.g[i]!.extensao_b_m),
                              cor: x.cor,
                            })),
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
