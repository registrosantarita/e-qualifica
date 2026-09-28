import { Check, Minus, X } from "lucide-react";
import { fmtMedida, anguloLiteral, coordToDms, docColor, docLetra } from "@/lib/labels";
import type { TrechoConferido } from "@/lib/comparison-engine";
import { agruparConfrontantes } from "@/lib/confrontantes";
import type { VertexCoordRow } from "@/lib/export-registral";

export function lerTrechos(metrics: Record<string, unknown>): TrechoConferido[] {
  const t = metrics["trechos"];
  return Array.isArray(t) ? (t as TrechoConferido[]) : [];
}

type Props = {
  trechos: TrechoConferido[];
  extensaoM?: number | null;
  labelA?: string;
  labelB?: string;
  /** Coordenadas dos vértices do documento A, indexadas pelo nome em maiúsculas. */
  vertices?: Map<string, VertexCoordRow> | undefined;
  /** Coordenadas dos vértices do documento comparado, indexadas pelo nome. */
  verticesB?: Map<string, VertexCoordRow> | undefined;
  /** Posição do documento paradigma na ordem de upload: 0 → A, 1 → B... */
  indiceA?: number;
  /** Posição do documento comparado na ordem de upload: 1 → B, 2 → C... */
  indiceB?: number;
  ignorarConfrontacoes?: boolean;
};

/** Valores empilhados: documento A acima, documento comparado abaixo. */
function Par({
  a,
  b,
  corA,
  corB,
  align = "right",
}: {
  a: string;
  b: string;
  corA: string;
  corB: string;
  align?: "right" | "left";
}) {
  const cls = align === "right" ? "text-right" : "text-left";
  return (
    <div className={`flex flex-col leading-tight ${cls}`}>
      <span className={corA}>{a}</span>
      <span className={corB}>{b}</span>
    </div>
  );
}



function Situacao({
  ok,
  problemas,
  comparado = true,
}: {
  ok: boolean;
  problemas: string[];
  comparado?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      {!comparado ? (
        <Minus className="h-5 w-5 text-muted-foreground" aria-label="Não conferido" />
      ) : ok ? (
        <Check className="h-5 w-5 text-success" aria-label="Correto" />
      ) : (
        <X className="h-5 w-5 text-destructive" aria-label="Incorreto" />
      )}
      <span className="max-w-[220px] whitespace-normal text-center text-[11px] leading-snug text-muted-foreground">
        {problemas.length > 0
          ? problemas.join("; ")
          : comparado
            ? ""
            : "sem dado comum para conferir"}
      </span>
    </div>
  );
}


const vname = (v: string | null | undefined): string =>
  (v ?? "").trim().replace(/[.,;]+$/, "").toUpperCase();

/** Conferência trecho a trecho: vértice inicial → final e conformidade. */
export function TrechosConferidos({
  trechos,
  extensaoM,
  labelA,
  labelB,
  vertices,
  verticesB,
  indiceA = 0,
  indiceB = 1,
  ignorarConfrontacoes = false,
}: Props) {
  if (trechos.length === 0) return null;
  const corA = docColor(indiceA);
  const corB = docColor(indiceB);
  const letraA = docLetra(indiceA);
  const letraB = docLetra(indiceB);


  const conformes = trechos.filter((t) => t.ok).length;
  const primeiro = trechos[0]!;
  const ultimo = trechos[trechos.length - 1]!;
  const inicio = primeiro.de_a ?? `seg. ${primeiro.seq_a}`;
  const fim = ultimo.ate_a ?? `seg. ${ultimo.seq_a}`;
  const confrontacoes = agruparConfrontantes(trechos);

  const coordDe = (t: TrechoConferido) => vertices?.get(vname(t.de_a));
  const coordDeB = (t: TrechoConferido) => verticesB?.get(vname(t.de_b));
  // Colunas geodésicas/planas só aparecem quando algum documento traz o dado.
  const temGeo = trechos.some((t) => {
    const v = coordDe(t);
    const w = coordDeB(t);
    return v?.lat != null || v?.lon != null || w?.lat != null || w?.lon != null;
  });
  const temPlana = trechos.some((t) => {
    const v = coordDe(t);
    const w = coordDeB(t);
    return (
      v?.north != null || v?.east != null || w?.north != null || w?.east != null
    );
  });

  return (
    <>
      <section className="panel mx-auto mt-8 w-fit max-w-[min(96rem,calc(100vw-3rem))] p-6 print:w-full print:max-w-none">
        <h2 className="text-lg">Conferência trecho a trecho</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Trecho total conferido: <span className="numeric">{inicio}</span> →{" "}
          <span className="numeric">{fim}</span> — {trechos.length} trecho(s),{" "}
          <span className="numeric">
            {fmtMedida(
              extensaoM ??
                trechos.reduce((acc, t) => acc + (t.distancia_a ?? 0), 0),
            )}{" "}
            m
          </span>
          . {conformes} de {trechos.length} conformes.
          {primeiro.invertido
            ? " Caminhamentos em sentidos opostos, conferidos por contra-azimute."
            : ""}
        </p>

        <div className="mt-5 w-full overflow-x-auto">
          <table className="mx-auto w-auto border-collapse text-sm [&_td]:whitespace-nowrap [&_td]:px-2 [&_th]:whitespace-nowrap [&_th]:px-2">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="eyebrow py-2 px-2">#</th>
                <th
                  className="eyebrow py-2 px-2"
                  title={`Doc. ${letraA}: ${labelA ?? ""} / Doc. ${letraB}: ${labelB ?? ""}`}
                >
                  TRECHO DE
                </th>
                <th
                  className="eyebrow py-2 px-2"
                  title={`Doc. ${letraA}: ${labelA ?? ""} / Doc. ${letraB}: ${labelB ?? ""}`}
                >
                  TRECHO PARA
                </th>
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
              {trechos.map((t) => {
                const v = coordDe(t);
                const w = coordDeB(t);
                return (
                  <tr
                    key={`${t.seq_a}-${t.seq_b}`}
                    className="border-b border-border/60 align-top"
                  >
                    <td className="numeric py-2 px-2 text-muted-foreground">{t.seq_a}</td>
                    <td className="numeric py-2 px-2">
                      <Par
                        a={t.de_a ?? "?"}
                        b={t.de_b ?? "?"}
                        corA={corA}
                        corB={corB}
                        align="left"
                      />
                    </td>
                    <td className="numeric py-2 px-2">
                      <Par
                        a={t.ate_a ?? "?"}
                        b={t.ate_b ?? "?"}
                        corA={corA}
                        corB={corB}
                        align="left"
                      />
                    </td>
                    {temGeo && (
                      <>
                        <td className="numeric py-2 px-2">
                          <Par
                            a={coordToDms(v?.lon ?? null, "lon")}
                            b={coordToDms(w?.lon ?? null, "lon")}
                            corA={corA}
                            corB={corB}
                          />
                        </td>
                        <td className="numeric py-2 px-2">
                          <Par
                            a={coordToDms(v?.lat ?? null, "lat")}
                            b={coordToDms(w?.lat ?? null, "lat")}
                            corA={corA}
                            corB={corB}
                          />
                        </td>
                      </>
                    )}
                    {temPlana && (
                      <>
                        <td className="numeric py-2 px-2">
                          <Par
                            a={fmtMedida(v?.north ?? null)}
                            b={fmtMedida(w?.north ?? null)}
                            corA={corA}
                            corB={corB}
                          />
                        </td>
                        <td className="numeric py-2 px-2">
                          <Par
                            a={fmtMedida(v?.east ?? null)}
                            b={fmtMedida(w?.east ?? null)}
                            corA={corA}
                            corB={corB}
                          />
                        </td>
                      </>
                    )}
                    <td className="numeric py-2 px-2">
                      <Par
                        a={fmtMedida(t.cota_a)}
                        b={fmtMedida(t.cota_b)}
                        corA={corA}
                        corB={corB}
                      />
                    </td>
                    <td className="numeric py-2 px-2">
                      <Par
                        a={anguloLiteral(t.azimute_txt_a, t.azimute_a, t.azimute_txt_b)}
                        b={anguloLiteral(t.azimute_txt_b, t.azimute_b, t.azimute_txt_a)}

                        corA={corA}
                        corB={corB}
                      />
                    </td>
                    <td className="numeric py-2 px-2">
                      <Par
                        a={fmtMedida(t.distancia_a)}
                        b={fmtMedida(t.distancia_b)}
                        corA={corA}
                        corB={corB}
                      />
                    </td>

                    <td className="py-2 px-2">
                      <Situacao ok={t.ok} problemas={t.problemas} comparado={t.comparado ?? true} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </section>

      {!ignorarConfrontacoes && confrontacoes.length > 0 && (
        <section className="panel mt-8 p-6">
          <h2 className="text-lg">Imóveis confrontantes</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Caminhamento resumido por confrontação: do vértice inicial ao final
            de cada divisa comum.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-auto min-w-full table-auto border-collapse text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="eyebrow py-2 pr-3">Confrontação</th>
                  <th className="eyebrow py-2 pr-3">Caminhamento</th>
                  <th className="eyebrow py-2 pr-3 text-right">Trechos</th>
                  <th className="eyebrow py-2 pr-3 text-right">Extensão (m)</th>
                  <th className="eyebrow py-2 pr-3 text-center">Situação</th>
                </tr>
              </thead>
              <tbody>
                {confrontacoes.map((g, i) => (
                  <tr
                    key={`${g.confrontante}-${i}`}
                    className="border-b border-border/60 align-top"
                  >
                    <td className="whitespace-nowrap py-2 pr-3">
                      <Par
                        a={g.confrontante || "—"}
                        b={g.confrontante_b || "—"}
                        corA={corA}
                        corB={corB}
                        align="left"
                      />
                    </td>
                    <td className="numeric whitespace-nowrap py-2 pr-3">
                      <Par
                        a={`${g.de} → ${g.ate}`}
                        b={
                          g.de_b || g.ate_b
                            ? `${g.de_b || "?"} → ${g.ate_b || "?"}`
                            : "—"
                        }
                        corA={corA}
                        corB={corB}
                        align="left"
                      />
                    </td>
                    <td className="numeric whitespace-nowrap py-2 pr-3 text-right">
                      <Par
                        a={String(g.trechos)}
                        b={g.trechos_b > 0 ? String(g.trechos_b) : "—"}
                        corA={corA}
                        corB={corB}
                      />
                    </td>
                    <td className="numeric whitespace-nowrap py-2 pr-3 text-right">
                      <Par
                        a={fmtMedida(g.extensao_m)}
                        b={g.extensao_b_m == null ? "—" : fmtMedida(g.extensao_b_m)}
                        corA={corA}
                        corB={corB}
                      />
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      <Situacao ok={g.ok} problemas={g.problemas} />
                    </td>
                  </tr>
                ))}

              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
