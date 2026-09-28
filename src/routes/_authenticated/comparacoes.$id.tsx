import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  CLASSIFICACAO,
  SEVERIDADE,
  TIPO_COMPARACAO,
  TONE_CLASS,
  fmtNum,
} from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { exportarRelatorioPdf } from "@/lib/export-registral";
import { TrechosConferidos, lerTrechos } from "@/components/TrechosConferidos";
import { TrechosConsolidados } from "@/components/TrechosConsolidados";
import { getVertices, type VertexCoordRow } from "@/lib/export-registral";
import { ValidacaoAchado } from "@/components/ValidacaoAchado";
import { ValidacoesEmLote } from "@/components/ValidacoesEmLote";
import { DECISAO_LABEL, ehDivergencia, lerDecisao } from "@/lib/finding-review";




export const Route = createFileRoute("/_authenticated/comparacoes/$id")({
  head: () => ({
    meta: [
      { title: "Relatório de comparação — GeoConfronto · e-Qualifica" },
      {
        name: "description",
        content:
          "Relatório auditável com achados classificados por severidade e evidências de origem.",
      },
      {
        property: "og:title",
        content: "Relatório de comparação — GeoConfronto · e-Qualifica",
      },
      {
        property: "og:description",
        content: "Achados técnicos rastreáveis da conferência registral.",
      },
    ],
  }),
  component: Relatorio,
});

const ORDEM: string[] = ["critical", "moderate", "inconclusive", "informative"];

function Relatorio() {
  const { id } = Route.useParams();
  const [mostrarOposicoes, setMostrarOposicoes] = useState(false);


  const comparison = useQuery({
    queryKey: ["comparison", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comparisons")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const analise = useQuery({
    enabled: !!comparison.data?.analysis_id,
    queryKey: ["analysis-status", comparison.data?.analysis_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analyses")
        .select("id, status")
        .eq("id", comparison.data!.analysis_id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const analiseConcluida =
    analise.data?.status === "completed" || analise.data?.status === "archived";

  const concluir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("analyses")
        .update({ status: "completed", closed_at: new Date().toISOString() })
        .eq("id", comparison.data!.analysis_id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Análise concluída: o relatório é definitivo.");
      analise.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const findings = useQuery({

    queryKey: ["findings", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("findings")
        .select("*")
        .eq("comparison_id", id);
      if (error) throw error;
      return data;
    },
  });

  const docs = useQuery({
    enabled: !!comparison.data,
    queryKey: ["comparison-docs", id],
    queryFn: async () => {
      const ids = [
        comparison.data!.document_a_id,
        comparison.data!.document_b_id,
      ].filter(Boolean) as string[];
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_name, document_category")
        .in("id", ids);
      if (error) throw error;
      return data;
    },
  });

  // Coordenadas dos vértices do documento A, para as colunas geodésicas/planas.
  const vertices = useQuery({
    enabled: !!comparison.data?.document_a_id,
    queryKey: ["comparison-vertices", id, comparison.data?.document_a_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parcels")
        .select("raw_extraction")
        .eq("document_id", comparison.data!.document_a_id!);
      if (error) throw error;
      const map = new Map<string, VertexCoordRow>();
      (data ?? []).forEach((p) => {
        getVertices({ raw_extraction: p.raw_extraction } as never).forEach((v) => {
          const key = String(v.name ?? "").trim().replace(/[.,;]+$/, "").toUpperCase();
          if (key && !map.has(key)) map.set(key, v);
        });
      });
      return map;
    },
  });

  // Mesmas coordenadas, agora do documento comparado (B, C, D...).
  const verticesB = useQuery({
    enabled: !!comparison.data?.document_b_id,
    queryKey: ["comparison-vertices-b", id, comparison.data?.document_b_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parcels")
        .select("raw_extraction")
        .eq("document_id", comparison.data!.document_b_id!);
      if (error) throw error;
      const map = new Map<string, VertexCoordRow>();
      (data ?? []).forEach((p) => {
        getVertices({ raw_extraction: p.raw_extraction } as never).forEach((v) => {
          const key = String(v.name ?? "").trim().replace(/[.,;]+$/, "").toUpperCase();
          if (key && !map.has(key)) map.set(key, v);
        });
      });
      return map;
    },
  });

  // Posição do documento comparado (B, C, D...) dentro da análise, usada para
  // colorir as informações de cada documento de forma consistente.
  const docsAnalise = useQuery({
    enabled: !!comparison.data?.analysis_id,
    queryKey: ["analysis-docs-order", comparison.data?.analysis_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_name, created_at")
        .eq("analysis_id", comparison.data!.analysis_id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Tabela consolidada: todas as comparações que partem do mesmo paradigma.
  const consolidado = useQuery({
    enabled: !!comparison.data?.document_a_id,
    queryKey: [
      "comparison-consolidado",
      comparison.data?.analysis_id,
      comparison.data?.document_a_id,
    ],
    queryFn: async () => {
      const docAId = comparison.data!.document_a_id!;
      const { data: comps, error: e1 } = await supabase
        .from("comparisons")
        .select("id, document_a_id, document_b_id, metrics, created_at")
        .eq("analysis_id", comparison.data!.analysis_id)
        .eq("document_a_id", docAId)
        .order("created_at", { ascending: true });
      if (e1) throw e1;

      // Mantém apenas a comparação mais recente de cada documento comparado,
      // para que reexecuções não dupliquem linhas na tabela consolidada.
      const porB = new Map<string, (typeof comps)[number]>();
      (comps ?? []).forEach((c) => {
        if (c.document_b_id) porB.set(c.document_b_id, c);
      });
      const unicos = Array.from(porB.values());

      const bIds = unicos
        .map((c) => c.document_b_id)
        .filter((v): v is string => !!v);

      const ids = Array.from(new Set([docAId, ...bIds]));

      const { data: parcelas, error: e2 } = await supabase
        .from("parcels")
        .select("document_id, raw_extraction")
        .in("document_id", ids);
      if (e2) throw e2;

      const mapas = new Map<string, Map<string, VertexCoordRow>>();
      (parcelas ?? []).forEach((p) => {
        const m = mapas.get(p.document_id) ?? new Map<string, VertexCoordRow>();
        getVertices({ raw_extraction: p.raw_extraction } as never).forEach((v) => {
          const key = String(v.name ?? "").trim().replace(/[.,;]+$/, "").toUpperCase();
          if (key && !m.has(key)) m.set(key, v);
        });
        mapas.set(p.document_id, m);
      });

      return { comps: unicos, mapas };
    },
  });


  if (comparison.isLoading || !comparison.data) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-sm text-muted-foreground">Carregando relatório...</p>
      </main>
    );
  }

  const c = comparison.data;
  const cls = CLASSIFICACAO[c.classification ?? "inconclusive"]!;
   const tol = (c.tolerances ?? {}) as Record<string, number | boolean>;
  const metrics = (c.metrics ?? {}) as Record<string, unknown>;
  const counts = (metrics["counts"] ?? {}) as Record<string, number>;
  const trechos = lerTrechos(metrics);
  const extensaoConferida =
    typeof metrics["extensao_conferida_m"] === "number"
      ? (metrics["extensao_conferida_m"] as number)
      : null;
  const nomeDoc = (docId: string | null) =>
    (docs.data ?? []).find((d) => d.id === docId)?.file_name ?? "Documento";

  // Letra/cor de cada documento segue a ordem de inclusão na guia de upload.
  const ordemDocs = (docsAnalise.data ?? []).map((d) => d.id);
  const posDoc = (docId: string | null, fallback: number) => {
    const i = docId ? ordemDocs.indexOf(docId) : -1;
    return i >= 0 ? i : fallback;
  };
  const nomeDocOrdem = (docId: string | null) =>
    (docsAnalise.data ?? []).find((d) => d.id === docId)?.file_name ??
    nomeDoc(docId);
  const indiceA = posDoc(c.document_a_id, 0);
  const indiceB = posDoc(c.document_b_id, 1);


  const ordenados = [...(findings.data ?? [])].sort(
    (a, b) => ORDEM.indexOf(a.severity) - ORDEM.indexOf(b.severity),
  );
  const divergentes = ordenados.filter((f) => ehDivergencia(f.severity));
  const compativeis = ordenados.filter((f) => !ehDivergencia(f.severity));


  const baixarPdf = () =>
    exportarRelatorioPdf(
      {
        titulo: `${nomeDoc(c.document_a_id)} × ${nomeDoc(c.document_b_id)}`,
        tipo: TIPO_COMPARACAO[c.comparison_type] ?? c.comparison_type,
        classificacao: c.classification,
        resumo: c.summary,
        emitidoEm: new Date(c.created_at).toLocaleString("pt-BR"),
        documentoA: nomeDoc(c.document_a_id),
        documentoB: nomeDoc(c.document_b_id),
        tolerancias: tol,
        contagens: counts,
        trechos,
        extensaoConferidaM: extensaoConferida,
        achados: ordenados.map((f) => {
          const d = lerDecisao(f);
          return {
            severity: f.severity,
            code: f.code,
            title: f.title,
            description: f.description,
            evidence: f.evidence,
            situacao:
              DECISAO_LABEL[d.decisao] +
              (d.grupo ? ` (validação nº ${d.grupo})` : ""),
            justificativa: d.justificativa,
          };
        }),
      },
      `relatorio-conferencia-${c.id.slice(0, 8)}.pdf`,
    );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 print:py-0">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link
          to="/analises/$id"
          params={{ id: c.analysis_id }}
          className="eyebrow hover:text-accent-foreground"
        >
          ← Voltar à análise
        </Link>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => baixarPdf()}>
            Baixar relatório (PDF)
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            Imprimir
          </Button>
        </div>

      </div>

      <header className="mt-6">
        <p className="eyebrow">Relatório auditável de conferência</p>
        <h1 className="mt-2 text-4xl leading-tight">
          {TIPO_COMPARACAO[c.comparison_type]}
        </h1>
        <div className="rule-gold mt-5 w-24" />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span
            className={`rounded-sm border px-3 py-1 text-xs ${TONE_CLASS[cls.tone]}`}
          >
            {cls.label}
          </span>
          <span className="numeric text-xs text-muted-foreground">
            Emitido em {new Date(c.created_at).toLocaleString("pt-BR")}
          </span>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-foreground">{c.summary}</p>
      </header>

      <section className="panel mt-8 p-6">
        <h2 className="text-lg">Documentos comparados</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="eyebrow">Documento A</dt>
            <dd className="mt-1 text-sm">{nomeDoc(c.document_a_id)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Documento B</dt>
            <dd className="mt-1 text-sm">{nomeDoc(c.document_b_id)}</dd>
          </div>
        </dl>

        <h3 className="mt-6 text-base">Tolerâncias adotadas</h3>
         {tol["ignoreConfrontations"] === true && (
           <p className="mt-2 text-sm text-muted-foreground">Confrontações ignoradas nesta comparação.</p>
         )}
        <dl className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-5">
          {[
            ["Área", `${fmtNum(tol["areaPct"] ?? null, 2)} %`],
            ["Perímetro", `${fmtNum(tol["perimeterPct"] ?? null, 2)} %`],
            ["Distância", `${fmtNum(tol["distanceM"] ?? null, 3)} m`],
            ["Azimute", `${fmtNum(tol["azimuthDeg"] ?? null, 4)} °`],
            ["Altitude", `${fmtNum(tol["altitudeM"] ?? null, 2)} m`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="eyebrow">{k}</dt>
              <dd className="numeric mt-1 text-sm">{v}</dd>
            </div>
          ))}
        </dl>

        <h3 className="mt-6 text-base">Resumo quantitativo</h3>
        <dl className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            ["Críticos", counts["critical"] ?? 0],
            ["Moderados", counts["moderate"] ?? 0],
            ["Informativos", counts["informative"] ?? 0],
            ["Inconclusivos", counts["inconclusive"] ?? 0],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <dt className="eyebrow">{k}</dt>
              <dd className="numeric mt-1 text-2xl">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {(() => {
        const temConsolidado = (consolidado.data?.comps.length ?? 0) > 1;
        const tabelaConsolidada = temConsolidado ? (
          <TrechosConsolidados
             ignorarConfrontacoes={tol["ignoreConfrontations"] === true}
            docA={{
              indice: indiceA,
              nome: nomeDocOrdem(c.document_a_id),
              vertices: consolidado.data!.mapas.get(c.document_a_id!),
            }}
            comparados={consolidado.data!.comps
              .filter((x) => !!x.document_b_id)
              .map((x) => ({
                indice: posDoc(x.document_b_id, 1),
                nome: nomeDocOrdem(x.document_b_id),
                trechos: lerTrechos((x.metrics ?? {}) as Record<string, unknown>),
                vertices: consolidado.data!.mapas.get(x.document_b_id!),
              }))
              .sort((a, b) => a.indice - b.indice)}
          />
        ) : null;

        const parAPar = (
          <TrechosConferidos
             ignorarConfrontacoes={tol["ignoreConfrontations"] === true}
            trechos={trechos}
            extensaoM={extensaoConferida}
            labelA={nomeDoc(c.document_a_id)}
            labelB={nomeDoc(c.document_b_id)}
            vertices={vertices.data}
            verticesB={verticesB.data}
            indiceA={indiceA}
            indiceB={indiceB}
          />
        );

        // Na comparação múltipla exibe apenas a conferência consolidada.
        return temConsolidado ? (
          <>{tabelaConsolidada}</>
        ) : (
          <>{parAPar}</>
        );
      })()}



      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-2xl">Achados</h2>
          <span className="text-xs text-muted-foreground">
            {divergentes.filter((f) => lerDecisao(f).decisao === "pendente").length}{" "}
            de {divergentes.length} divergências aguardando validação humana
          </span>
        </div>

        <ul className="mt-5 space-y-4">
          {ordenados.map((f) => {
            const sev = SEVERIDADE[f.severity]!;
            return (
              <li key={f.id} className="panel p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-sm border px-2 py-0.5 text-[11px] ${TONE_CLASS[sev.tone]}`}
                  >
                    {sev.label}
                  </span>
                  <h3 className="text-lg">{f.title}</h3>
                  <span className="eyebrow ml-auto">{f.code}</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-foreground">
                  {f.description}
                </p>
                <details className="mt-4">
                  <summary className="eyebrow cursor-pointer hover:text-accent-foreground">
                    Evidência técnica
                  </summary>
                  <pre className="numeric mt-3 overflow-x-auto rounded-sm bg-muted p-4 text-[11px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(f.evidence, null, 2)}
                  </pre>
                </details>
                <ValidacaoAchado achado={f} onSalvo={() => findings.refetch()} />
              </li>
            );
          })}

          {ordenados.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum achado registrado nesta comparação.
            </p>
          )}
        </ul>

        <ValidacoesEmLote
          comparisonId={id}
          achados={divergentes}
          todos={ordenados}
          onSalvo={() => findings.refetch()}
        />

        {ordenados.length > 0 && (
          <div className="panel mt-8 flex flex-wrap items-center gap-4 p-6 print:hidden">
            <div>
              <h3 className="text-lg">Confirmar conferência</h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {divergentes.length > 0
                  ? "Há divergências aguardando validação humana. Ainda assim, é possível encerrar a análise e tornar o relatório definitivo com os achados registrados."
                  : "Nenhuma divergência foi apontada — apenas trechos compatíveis (informativos). Confirme para encerrar a análise e tornar o relatório definitivo."}
              </p>
            </div>
            <Button
              size="sm"
              className="ml-auto"
              disabled={concluir.isPending || analiseConcluida}
              onClick={() => concluir.mutate()}
            >
              {analiseConcluida ? "Análise já concluída" : "Confirmar análise"}
            </Button>
          </div>
        )}

        {compativeis.length > 0 && (
          <div className="mt-8 print:hidden">
            {mostrarOposicoes ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setMostrarOposicoes(false)}
                >
                  Fechar oposições
                </Button>
                <ValidacoesEmLote
                  comparisonId={id}
                  achados={compativeis}
                  todos={ordenados}
                  modo="oposicao"
                  onSalvo={() => findings.refetch()}
                />
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  Trechos compatíveis não exigem justificativa. Se quiser
                  contraditá-los excepcionalmente, abra as oposições.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => setMostrarOposicoes(true)}
                >
                  Oposições ({compativeis.length})
                </Button>
              </div>
            )}
          </div>
        )}


      </section>

      <div className="mt-10 flex flex-wrap items-center gap-2 print:hidden">
        <Button size="sm" onClick={() => baixarPdf()}>
          Baixar relatório (PDF)
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          Imprimir
        </Button>
        <Link
          to="/analises/$id"
          params={{ id: c.analysis_id }}
          className="eyebrow ml-auto hover:text-accent-foreground"
        >
          ← Voltar à análise
        </Link>
      </div>

      <footer className="mt-12 border-t border-border pt-6">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Este relatório é instrumento de apoio à decisão. Não substitui a
          qualificação jurídica e técnica do Oficial. Todos os achados são
          rastreáveis até a evidência textual de origem registrada na análise.
        </p>
      </footer>
    </main>
  );
}
