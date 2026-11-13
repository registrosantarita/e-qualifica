import { supabase } from "@/integrations/supabase/client";
import { TIPO_COMPARACAO } from "./labels";
import { readOverlay } from "./overlay-engine";
import { DECISAO_LABEL, lerDecisao } from "./finding-review";
import type { RelatorioPdfInput } from "./export-registral";
import type { TrechoConferido } from "./comparison-engine";

export async function loadComparisonReport(id: string): Promise<RelatorioPdfInput> {
  const { data: c, error } = await supabase.from("comparisons").select("*").eq("id", id).single();
  if (error) throw error;
  const { data: findings, error: findingError } = await supabase.from("findings").select("*").eq("comparison_id", id);
  if (findingError) throw findingError;
  const metrics = (c.metrics ?? {}) as Record<string, unknown>;
  const third = typeof metrics["document_c_id"] === "string" ? metrics["document_c_id"] : null;
  const ids = [c.document_a_id, c.document_b_id, third].filter((v): v is string => !!v);
  const { data: docs, error: docsError } = await supabase.from("documents").select("id,file_name").in("id", ids);
  if (docsError) throw docsError;
  const name = (id: string | null) => docs?.find(d => d.id === id)?.file_name ?? "Documento";
  return {
    titulo: [name(c.document_a_id), name(c.document_b_id), ...(third ? [name(third)] : [])].join(" × "),
    tipo: TIPO_COMPARACAO[c.comparison_type] ?? c.comparison_type, classificacao: c.classification, resumo: c.summary,
    emitidoEm: new Date(c.created_at).toLocaleString("pt-BR"), documentoA: name(c.document_a_id), documentoB: name(c.document_b_id), documentoC: third ? name(third) : undefined,
    overlay: readOverlay(metrics), tolerancias: (c.tolerances ?? {}) as Record<string, number | boolean>, contagens: (metrics["counts"] ?? {}) as Record<string, number>,
    trechos: Array.isArray(metrics["trechos"]) ? metrics["trechos"] as TrechoConferido[] : [],
    extensaoConferidaM: typeof metrics["extensao_conferida_m"] === "number" ? metrics["extensao_conferida_m"] : null,
    achados: (findings ?? []).map(f => { const d = lerDecisao(f); return { severity: f.severity, code: f.code, title: f.title, description: f.description, evidence: f.evidence, situacao: DECISAO_LABEL[d.decisao] + (d.grupo ? ` (validação nº ${d.grupo})` : ""), justificativa: d.justificativa }; }),
  };
}