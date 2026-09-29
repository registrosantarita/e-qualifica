/**
 * Painel "Relatórios": permite gerar o PDF de qualquer comparação da análise
 * depois da conclusão, ou a qualquer momento para administradores.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CLASSIFICACAO, TIPO_COMPARACAO, TONE_CLASS } from "@/lib/labels";
import { exportarRelatorioPdf } from "@/lib/export-registral";
import { lerTrechos } from "@/components/TrechosConferidos";
import { DECISAO_LABEL, lerDecisao } from "@/lib/finding-review";

type ComparacaoResumo = {
  id: string;
  comparison_type: string;
  classification: string | null;
  summary: string | null;
  created_at: string;
};

export function RelatoriosAnalise({
  comparacoes,
  podeGerar,
  onExcluido,
}: {
  comparacoes: ComparacaoResumo[];
  podeGerar: boolean;
  onExcluido?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [gerando, setGerando] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [excluindo, setExcluindo] = useState(false);

  const alternar = (id: string) =>
    setSelecionados((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  async function excluirSelecionados() {
    setExcluindo(true);
    try {
      const { error: e1 } = await supabase
        .from("findings")
        .delete()
        .in("comparison_id", selecionados);
      if (e1) throw e1;
      const { error } = await supabase
        .from("comparisons")
        .delete()
        .in("id", selecionados);
      if (error) throw error;
      toast.success(
        selecionados.length === 1
          ? "Relatório excluído."
          : `${selecionados.length} relatórios excluídos.`,
      );
      setSelecionados([]);
      onExcluido?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Não foi possível excluir.",
      );
    } finally {
      setExcluindo(false);
    }
  }


  async function gerar(comparacaoId: string) {
    if (!podeGerar) return;
    setGerando(comparacaoId);
    try {
      const { data: c, error } = await supabase
        .from("comparisons")
        .select("*")
        .eq("id", comparacaoId)
        .single();
      if (error) throw error;

      const { data: findings, error: e2 } = await supabase
        .from("findings")
        .select("*")
        .eq("comparison_id", comparacaoId);
      if (e2) throw e2;

      const ids = [c.document_a_id, c.document_b_id].filter(
        (v): v is string => !!v,
      );
      const { data: docs } = await supabase
        .from("documents")
        .select("id, file_name")
        .in("id", ids);
      const nomeDoc = (docId: string | null) =>
        (docs ?? []).find((d) => d.id === docId)?.file_name ?? "Documento";

      const metrics = (c.metrics ?? {}) as Record<string, unknown>;
      const counts = (metrics["counts"] ?? {}) as Record<string, number>;
      const extensao =
        typeof metrics["extensao_conferida_m"] === "number"
          ? (metrics["extensao_conferida_m"] as number)
          : null;

      exportarRelatorioPdf(
        {
          titulo: `${nomeDoc(c.document_a_id)} × ${nomeDoc(c.document_b_id)}`,
          tipo: TIPO_COMPARACAO[c.comparison_type] ?? c.comparison_type,
          classificacao: c.classification,
          resumo: c.summary,
          emitidoEm: new Date(c.created_at).toLocaleString("pt-BR"),
          documentoA: nomeDoc(c.document_a_id),
          documentoB: nomeDoc(c.document_b_id),
           tolerancias: (c.tolerances ?? {}) as Record<string, number | boolean>,
          contagens: counts,
          trechos: lerTrechos(metrics),
          extensaoConferidaM: extensao,
          achados: (findings ?? []).map((f) => {
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
        `relatorio-conferencia-${comparacaoId.slice(0, 8)}.pdf`,
      );
      toast.success("Relatório gerado.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Não foi possível gerar o relatório.",
      );
    } finally {
      setGerando(null);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {podeGerar ? "Relatórios" : "Gerenciar relatórios"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Relatórios das comparações</DialogTitle>
          <DialogDescription>
            {podeGerar
              ? "Gere PDFs das comparações. O conteúdo reflete as validações humanas registradas."
              : "Para gerar PDFs, conclua a análise após conferir as inconsistências. Administradores podem gerar antes da conclusão."}
          </DialogDescription>
        </DialogHeader>

        {comparacoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma comparação registrada nesta análise.
          </p>
        ) : (
          <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelecionados(comparacoes.map((c) => c.id))}
            >
              Selecionar todos
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={selecionados.length === 0}
              onClick={() => setSelecionados([])}
            >
              Limpar seleção
            </Button>
            <span className="text-xs text-muted-foreground">
              {selecionados.length} selecionado(s)
            </span>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="ml-auto"
                  disabled={selecionados.length === 0 || excluindo}
                >
                  {excluindo ? "Excluindo..." : "Excluir selecionados"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir relatórios?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {selecionados.length} relatório(s) de comparação e seus
                    achados serão removidos definitivamente desta análise.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => excluirSelecionados()}>
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <ul className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {comparacoes.map((c) => {
              const cls = CLASSIFICACAO[c.classification ?? "inconclusive"]!;
              return (
                <li
                  key={c.id}
                  className="rounded-sm border border-border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Checkbox
                      checked={selecionados.includes(c.id)}
                      onCheckedChange={() => alternar(c.id)}
                      aria-label="Selecionar relatório"
                    />
                    <span className="font-display text-sm">
                      {TIPO_COMPARACAO[c.comparison_type] ?? c.comparison_type}
                    </span>
                    <span
                      className={`rounded-sm border px-2 py-0.5 text-[11px] ${TONE_CLASS[cls.tone]}`}
                    >
                      {cls.label}
                    </span>
                    <span className="numeric ml-auto text-[11px] text-muted-foreground">
                      {new Date(c.created_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  {c.summary && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {c.summary}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {podeGerar && (
                      <Button size="sm" disabled={gerando === c.id} onClick={() => gerar(c.id)}>
                        {gerando === c.id ? "Gerando..." : "Baixar PDF"}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        to="/comparacoes/$id"
                        params={{ id: c.id }}
                        onClick={() => setAberto(false)}
                      >
                        Abrir relatório
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
