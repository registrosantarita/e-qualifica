import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  processDocument,
  runComparison,
  runLotBatchComparison,
} from "@/lib/registral.functions";
import { souAdmin, excluirDocumento, excluirComparacao } from "@/lib/admin.functions";
import { DEFAULT_TOLERANCES } from "@/lib/comparison-engine";
import { ehDivergencia, lerDecisao } from "@/lib/finding-review";


import { isCadExtension } from "@/lib/cad-ext";
import {
  CATEGORIA_DOCUMENTO,
  CLASSIFICACAO,
  STATUS_ANALISE,
  STATUS_ANALISE_CLASS,
  STATUS_DOCUMENTO,
  TIPO_COMPARACAO,
  TONE_CLASS,
  anguloLiteral,
  coordToDms,
  fmtMedida,
  fmtNum,
} from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { exportarMatriculaXlsx } from "@/lib/export-matricula";
import type { VertexCoordRow } from "@/lib/export-registral";
import type { ParcelExport } from "@/lib/export-registral";
import { baixarGeometria, montarDwg, montarKml, montarKmz } from "@/lib/export-geometria";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HelpCircle } from "lucide-react";
import { EstimativaCreditosArquivo } from "@/components/EstimativaCreditos";
import { RelatoriosAnalise } from "@/components/RelatoriosAnalise";


export const Route = createFileRoute("/_authenticated/analises/$id")({
  head: () => ({
    meta: [
      { title: "Análise — GeoConfronto · e-Qualifica" },
      {
        name: "description",
        content:
          "Documentos, extrações técnicas, comparações e trilha de auditoria da análise registral.",
      },
      { property: "og:title", content: "Análise — GeoConfronto · e-Qualifica" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        property: "og:description",
        content: "Detalhe do caso de conferência registral e geométrica.",
      },
    ],
  }),
  component: AnaliseDetalhe,
});

type DocRow = {
  id: string;
  source_document_id: string | null;
  file_name: string | null;
  file_extension: string | null;
  source_type: string;
  document_category: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

function AnaliseDetalhe() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const extrair = useServerFn(processDocument);
  const comparar = useServerFn(runComparison);
  const conferirLoteALote = useServerFn(runLotBatchComparison);

  const [texto, setTexto] = useState("");
  const [arquivosPendentes, setArquivosPendentes] = useState<File[]>([]);
  const [progressoLote, setProgressoLote] = useState<{
    atual: number;
    total: number;
    nome: string;
  } | null>(null);
  const [nomeTexto, setNomeTexto] = useState("");
  const [categoria, setCategoria] = useState("nao_classificado");

  const [docA, setDocA] = useState("");
  const [parcelA, setParcelA] = useState("");
  /** Documentos comparáveis (B, C, D...) confrontados com o paradigma A. */
  const [comparaveis, setComparaveis] = useState<
    { doc: string; parcel: string }[]
  >([{ doc: "", parcel: "" }]);
  const [tipo, setTipo] = useState("memorial_to_memorial");
  const [tol, setTol] = useState(DEFAULT_TOLERANCES);
  const [unidadeArea, setUnidadeArea] = useState<"m2" | "ha">("m2");
  /** Acordeões de documentos expandidos para facilitar acesso às ações. */
  const [openDocs, setOpenDocs] = useState<string[]>([]);

  const analysis = useQuery({
    queryKey: ["analysis", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analyses")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  /** Achados de toda a análise, para controlar a validação humana. */
  const achadosAnalise = useQuery({
    queryKey: ["findings-analise", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("findings")
        .select("id, severity, reviewed, reviewer_note")
        .eq("analysis_id", id);
      if (error) throw error;
      return data;
    },
  });

  const mudarStatus = useMutation({
    mutationFn: async (status: "draft" | "completed" | "archived") => {
      const { error } = await supabase
        .from("analyses")
        .update({
          status,
          closed_at: status === "draft" ? null : new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analysis", id] });
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
      toast.success("Situação da análise atualizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const documents = useQuery({
    queryKey: ["documents", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select(
          "id, source_document_id, file_name, file_extension, source_type, document_category, status, error_message, created_at",
        )
        .eq("analysis_id", id)
        .order("created_at");
      if (error) throw error;
      return data as DocRow[];
    },
  });

  const parcels = useQuery({
    queryKey: ["parcels", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parcels")
        .select("*, segments(*)")
        .eq("analysis_id", id);
      if (error) throw error;
      return data;
    },
  });

  const comparisons = useQuery({
    queryKey: ["comparisons", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comparisons")
        .select("id, comparison_type, classification, summary, created_at")
        .eq("analysis_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const auditoria = useQuery({
    queryKey: ["audit", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  function refreshDocs() {
    queryClient.invalidateQueries({ queryKey: ["documents", id] });
    queryClient.invalidateQueries({ queryKey: ["parcels", id] });
  }

  const enviarTexto = useMutation({
    mutationFn: async () => {
      if (texto.trim().length < 40)
        throw new Error("Cole ao menos 40 caracteres do memorial.");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const { data, error } = await supabase
        .from("documents")
        .insert({
          analysis_id: id,
          source_type: "pasted_text",
          file_name: nomeTexto.trim() || "Texto colado",
          document_category: categoria as never,
          original_text: texto.slice(0, 200000),
          created_by: uid,
        })
        .select("id")
        .single();
      if (error) throw error;
      return extrair({ data: { documentId: data.id } });
    },
    onSuccess: (res) => {
      setTexto("");
      setNomeTexto("");
      refreshDocs();
      if (res.ok) {
        toast.success(`Extração concluída: ${res.segments} segmento(s).`);
        res.warnings.forEach((w) => toast.warning(w));
      } else {
        toast.error(res.message);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Envia um arquivo, cria o documento e dispara a extração. */
  async function subirArquivo(file: File, uid: string) {
    if (file.size > 25 * 1024 * 1024) throw new Error("Arquivo acima de 25 MB.");
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

    /** DWG/DXF são convertidos no navegador em memorial tabular. */
    let textoCad: string | null = null;
    if (isCadExtension(ext)) {
      const { lerArquivoCad } = await import("@/lib/cad-reader.browser");
      const conv = await lerArquivoCad(file);
      if (!conv.text.trim())
        throw new Error(
          conv.aviso ?? "Não foi possível extrair geometria do arquivo CAD.",
        );
      if (conv.aviso) toast.warning(conv.aviso);
      textoCad = conv.text.slice(0, 200000);
    }

    const path = `${uid}/${id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("documentos")
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
      });
    if (upErr) throw new Error("Falha no envio do arquivo.");
    const { data, error } = await supabase
      .from("documents")
      .insert({
        analysis_id: id,
        source_type: "upload",
        file_name: file.name.slice(0, 255),
        file_extension: ext,
        mime_type: file.type || null,
        file_size_bytes: file.size,
          storage_path: path,
          document_category: categoria as never,
        ...(textoCad ? { original_text: textoCad } : {}),
        created_by: uid,
      })
      .select("id")
      .single();
    if (error) throw error;
    return extrair({ data: { documentId: data.id } });
  }

  /** Envio em lote: processa os arquivos selecionados em sequência. */
  const enviarArquivos = useMutation({
    mutationFn: async (files: File[]) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      let ok = 0;
      const falhas: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        setProgressoLote({ atual: i + 1, total: files.length, nome: file.name });
        try {
          const res = await subirArquivo(file, uid);
          if (res.ok) {
            ok++;
            res.warnings.forEach((w) => toast.warning(`${file.name}: ${w}`));
            if (res.note) toast.warning(`${file.name}: ${res.note}`);
          } else {
            falhas.push(`${file.name}: ${res.message}`);
          }
        } catch (e) {
          falhas.push(`${file.name}: ${(e as Error).message}`);
        }
        refreshDocs();
      }
      return { ok, falhas };
    },
    onSuccess: ({ ok, falhas }) => {
      setArquivosPendentes([]);
      setProgressoLote(null);
      refreshDocs();
      if (ok > 0) toast.success(`${ok} arquivo(s) processado(s). As descrições separadas estão na lista abaixo.`);
      falhas.forEach((f) => toast.warning(f));
    },
    onError: (e: Error) => {
      setProgressoLote(null);
      toast.error(e.message);
    },
  });

  /** Reclassificação da natureza documental após o upload. */
  const alterarCategoria = useMutation({
    mutationFn: async (v: { documentId: string; categoria: string }) => {
      const { error } = await supabase
        .from("documents")
        .update({ document_category: v.categoria as never })
        .eq("id", v.documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshDocs();
      toast.success("Natureza do documento atualizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const souAdminFn = useServerFn(souAdmin);
  const admin = useQuery({
    queryKey: ["sou-admin"],
    queryFn: () => souAdminFn({}),
    staleTime: 5 * 60 * 1000,
  });

  const excluirDocFn = useServerFn(excluirDocumento);
  const excluirDoc = useMutation({
    mutationFn: (documentId: string) => excluirDocFn({ data: { documentId } }),
    onSuccess: () => {
      refreshDocs();
      queryClient.invalidateQueries({ queryKey: ["comparisons", id] });
      queryClient.invalidateQueries({ queryKey: ["findings-analise", id] });
      toast.success("Documento excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluirCompFn = useServerFn(excluirComparacao);
  const excluirComp = useMutation({
    mutationFn: (comparisonId: string) => excluirCompFn({ data: { comparisonId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comparisons", id] });
      queryClient.invalidateQueries({ queryKey: ["findings-analise", id] });
      queryClient.invalidateQueries({ queryKey: ["audit", id] });
      toast.success("Comparação excluída e registrada na trilha de auditoria.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reprocessar = useMutation({
    mutationFn: (documentId: string) => extrair({ data: { documentId } }),
    onSuccess: () => {
      refreshDocs();
      toast.success("Documento reprocessado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const executarComparacao = useMutation({
    mutationFn: async () => {
      const alvos = comparaveis.filter((c) => c.doc);
      if (!docA || alvos.length === 0)
        throw new Error("Selecione o documento paradigma e ao menos um comparável.");
      const resultados: { comparisonId: string; classification: string | null }[] = [];
      for (const alvo of alvos) {
        if (alvo.doc === docA && tipo !== "boundary_to_boundary")
          throw new Error(
            "Cada documento comparável precisa ser distinto do paradigma.",
          );
        if (alvo.doc === docA && parcelA && parcelA === alvo.parcel)
          throw new Error("Selecione dois polígonos distintos do documento.");
        const r = await comparar({
          data: {
            analysisId: id,
            documentAId: docA,
            documentBId: alvo.doc,
            ...(parcelA ? { parcelAId: parcelA } : {}),
            ...(alvo.parcel ? { parcelBId: alvo.parcel } : {}),
            comparisonType: tipo as never,
            tolerances: tol,
          },
        });
        resultados.push(r);
      }
      return resultados;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["comparisons", id] });
      queryClient.invalidateQueries({ queryKey: ["findings-analise", id] });
      if (res.length === 0) return;
      if (res.length > 1) {
        const divergentes = res.filter(
          (r) => r.classification === "incompatible",
        ).length;
        toast.success(
          `${res.length} documentos comparados com o paradigma: ${divergentes} com divergência. Abrindo a conferência consolidada.`,
        );
      }
      navigate({ to: "/comparacoes/$id", params: { id: res[0]!.comparisonId } });
    },

    onError: (e: Error) => toast.error(e.message),
  });

  const conferirLotes = useMutation({
    mutationFn: async () => {
      const planta = comparaveis.find((c) => c.doc)?.doc ?? "";
      if (!docA || !planta)
        throw new Error("Selecione o memorial e a planta.");
      return conferirLoteALote({
        data: {
          analysisId: id,
          memorialDocumentId: docA,
          plantaDocumentId: planta,
          tolerances: tol,
        },
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["comparisons", id] });
      queryClient.invalidateQueries({ queryKey: ["findings-analise", id] });
      queryClient.invalidateQueries({ queryKey: ["findings", id] });
      toast.success(
        ("modo" in res && res.modo === "cotas_avulsas"
          ? "Planta sem rótulos de lote: pareamento feito pela área cotada. "
          : "") +
          `${res.figuras} figura(s) conferida(s): ${res.divergentes} com divergência, ${res.conformes} conforme(s).` +
          (res.soNoMemorial || res.soNaPlanta
            ? ` Sem par: ${res.soNoMemorial} no memorial, ${res.soNaPlanta} na planta.`
            : ""),
      );

    },
    onError: (e: Error) => toast.error(e.message),
  });


  const extraidos = (documents.data ?? []).filter((d) => d.status === "parsed");

  /** Polígonos (parcelas) extraídos de um documento, na ordem de leitura. */
  function poligonosDe(documentId: string) {
    return (parcels.data ?? [])
      .filter((p) => p.document_id === documentId)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  const tipoSugerido = (() => {
    const cat = (id: string) =>
      extraidos.find((d) => d.id === id)?.document_category ?? "";
    const a = cat(docA);
    const b = cat(comparaveis.find((c) => c.doc)?.doc ?? "");
    if (!a || !b) return null;
    const par = [a, b].sort().join("|");
    if (par === "memorial|memorial") return "memorial_to_memorial";
    if (par === "memorial|planta") return "memorial_to_plan";
    if (par === "planta|planta") return "plan_to_plan";
    if (par === "matricula|memorial") return "memorial_to_registry";
    if (par === "escritura|memorial") return "memorial_to_title";
    return null;
  })();

  useEffect(() => {
    if (tipoSugerido) setTipo(tipoSugerido);
  }, [tipoSugerido]);

  useEffect(() => {
    if (!documents.data || !parcels.data) return;
    const parsedWithParcel = documents.data
      .filter((d) => d.status === "parsed")
      .filter((d) => parcels.data!.some((p) => p.document_id === d.id))
      .map((d) => d.id);
    if (openDocs.length === 0 && parsedWithParcel.length > 0) {
      setOpenDocs(parsedWithParcel);
    }
  }, [documents.data, parcels.data]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/painel" className="eyebrow hover:text-accent-foreground">
        ← Voltar ao painel
      </Link>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="max-w-3xl text-4xl leading-tight">
            {analysis.data?.title ?? "Carregando..."}
          </h1>
          {analysis.data?.objective && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {analysis.data.objective}
            </p>
          )}
        </div>
        {analysis.data && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className={STATUS_ANALISE_CLASS[analysis.data.status]}
            >
              {STATUS_ANALISE[analysis.data.status]}
            </Badge>
            <RelatoriosAnalise
              comparacoes={comparisons.data ?? []}
              onExcluido={() => comparisons.refetch()}
            />
          </div>
        )}
      </div>

      <div className="rule-gold mt-6 w-24" />

      {analysis.data &&
        (() => {
          const achados = (achadosAnalise.data ?? []).filter((f) =>
            ehDivergencia(f.severity),
          );
          const pendentes = achados.filter(
            (f) => lerDecisao(f).decisao === "pendente",
          );
          const definitiva =
            analysis.data.status === "completed" ||
            analysis.data.status === "archived";
          return (
            <section className="panel mt-6 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg">Encerramento da conferência</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {definitiva
                      ? "Análise encerrada: o relatório é definitivo e permanece disponível para consulta."
                      : achados.length === 0
                        ? "Nenhuma divergência a validar — apenas trechos compatíveis (informativos). Confirme para encerrar a análise e tornar o relatório definitivo."
                        : `${achados.length - pendentes.length} de ${achados.length} divergências validadas. Cada divergência deve ser confirmada ou relevada com justificativa, no relatório da comparação, antes do encerramento. Trechos compatíveis não exigem justificativa.`}

                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {definitiva ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => mudarStatus.mutate("draft")}
                    >
                      Reabrir análise
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={mudarStatus.isPending || pendentes.length > 0}
                      onClick={() => mudarStatus.mutate("completed")}
                    >
                      Concluir análise
                    </Button>
                  )}
                </div>
              </div>
              {!definitiva && pendentes.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Restam {pendentes.length} achado(s) sem validação humana.
                </p>
              )}
            </section>
          );
        })()}


      <Tabs defaultValue="documentos" className="mt-8">
        <TabsList>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="comparacoes">Comparações</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
        </TabsList>

        {/* ---------------- DOCUMENTOS ---------------- */}
        <TabsContent value="documentos" className="mt-6 space-y-8">
          <section className="panel p-6">
            <h2 className="text-xl">Ingerir documento</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Envie um arquivo (PDF e texto simples têm leitura automática) ou
              cole o texto do memorial descritivo.
            </p>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Natureza documental (padrão do envio)</Label>
                  <Select value={categoria} onValueChange={setCategoria}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORIA_DOCUMENTO).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    A natureza pode ser definida ou corrigida depois do envio,
                    documento por documento, na lista abaixo.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="arquivo">Arquivos</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="arquivo"
                      type="file"
                      multiple
                      className="flex-1"
                      accept=".pdf,.txt,.csv,.md,.docx,.xlsx,.png,.jpg,.jpeg,.tif,.tiff,.webp,.kml,.kmz,.geojson,.json,.dwg,.dxf"
                      disabled={enviarArquivos.isPending}
                      onChange={(e) => {
                        const fs = Array.from(e.target.files ?? []);
                        if (fs.length)
                          setArquivosPendentes((prev) => [...prev, ...fs]);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={enviarArquivos.isPending}
                      onClick={() =>
                        document.getElementById("arquivo")?.click()
                      }
                    >
                      Procurar…
                    </Button>
                  </div>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Selecione vários arquivos de uma só vez. PDFs digitalizados e
                    imagens passam por OCR assistido por IA. Arquivos KML, KMZ e
                    GeoJSON têm o perímetro, os azimutes e a área calculados
                    diretamente da geometria (WGS-84). Arquivos CAD (DWG e DXF)
                    são lidos no próprio navegador: as polilinhas fechadas do
                    espaço do modelo viram perímetro, azimutes, distâncias e
                    área, sem consumo de créditos de IA.
                  </p>
                </div>
                {arquivosPendentes.length === 1 && (
                  <EstimativaCreditosArquivo
                    arquivo={arquivosPendentes[0]!}
                    processando={enviarArquivos.isPending}
                    onCancelar={() => setArquivosPendentes([])}
                    onConfirmar={() =>
                      enviarArquivos.mutate(arquivosPendentes)
                    }
                  />
                )}
                {arquivosPendentes.length > 1 && (
                  <div className="space-y-3 rounded-sm border border-border p-4">
                    <p className="text-sm">
                      {arquivosPendentes.length} arquivo(s) na fila de envio
                    </p>
                    <ul className="max-h-48 space-y-1 overflow-auto text-xs text-muted-foreground">
                      {arquivosPendentes.map((f, i) => (
                        <li
                          key={`${f.name}-${i}`}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="truncate">{f.name}</span>
                          {!enviarArquivos.isPending && (
                            <button
                              type="button"
                              className="shrink-0 underline"
                              onClick={() =>
                                setArquivosPendentes((prev) =>
                                  prev.filter((_, j) => j !== i),
                                )
                              }
                            >
                              remover
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {progressoLote && (
                      <p className="text-xs text-muted-foreground">
                        Processando {progressoLote.atual} de{" "}
                        {progressoLote.total}: {progressoLote.nome}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        onClick={() => enviarArquivos.mutate(arquivosPendentes)}
                        disabled={enviarArquivos.isPending}
                      >
                        {enviarArquivos.isPending
                          ? "Enviando..."
                          : `Enviar ${arquivosPendentes.length} arquivos`}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={enviarArquivos.isPending}
                        onClick={() => setArquivosPendentes([])}
                      >
                        Limpar
                      </Button>
                    </div>
                  </div>
                )}


              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="nome-texto">Identificação do texto</Label>
                  <Input
                    id="nome-texto"
                    value={nomeTexto}
                    onChange={(e) => setNomeTexto(e.target.value)}
                    placeholder="Ex.: Memorial do requerente"
                    maxLength={255}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="texto">Texto do memorial</Label>
                  <Textarea
                    id="texto"
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    rows={6}
                    placeholder="Cole aqui o memorial descritivo..."
                  />
                </div>
                <Button
                  onClick={() => enviarTexto.mutate()}
                  disabled={enviarTexto.isPending}
                >
                  {enviarTexto.isPending ? "Extraindo..." : "Extrair do texto"}
                </Button>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl">Documentos da análise</h2>
            {documents.isLoading ? (
              <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
            ) : (documents.data ?? []).length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Nenhum documento ingerido até o momento.
              </p>
            ) : (
              <Accordion
                type="multiple"
                className="mt-4"
                value={openDocs}
                onValueChange={setOpenDocs}
              >
                {documents.data!.filter((d) => !documents.data!.some((filho) => filho.source_document_id === d.id)).map((d) => {
                  const parcel = (parcels.data ?? []).find(
                    (p) => p.document_id === d.id,
                  );
                  const dadosExportacao = (): ParcelExport | null => parcel ? {
                    label: parcel.label,
                    area_m2: parcel.area_m2,
                    declared_perimeter_m: parcel.declared_perimeter_m,
                    computed_perimeter_m: parcel.computed_perimeter_m,
                    vertex_count: parcel.vertex_count,
                    raw_extraction: parcel.raw_extraction,
                    segments: parcel.segments ?? [],
                  } : null;
                  const baseExportacao = (d.file_name ?? "descricao").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
                  const exportarGeometria = async (formato: "kml" | "kmz" | "dwg") => {
                    const dados = dadosExportacao();
                    if (!dados) return;
                    try {
                      let file: string | Uint8Array;
                      let reference = "";
                      if (formato === "kml") file = montarKml(dados);
                      else if (formato === "kmz") file = montarKmz(dados);
                      else {
                        const result = await montarDwg(dados);
                        file = result.bytes;
                        reference = result.reference;
                      }
                      baixarGeometria(file, `perimetro-${baseExportacao}-${d.id.slice(0, 8)}.${formato}`, formato === "kml" ? "application/vnd.google-earth.kml+xml" : formato === "kmz" ? "application/vnd.google-earth.kmz" : "application/acad");
                      toast.success(`${formato.toUpperCase()} exportado.${reference ? ` ${reference}.` : ""}`);
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Não foi possível exportar a geometria.");
                    }
                  };
                  const gerarMatricula = async () => {
                    if (!parcel) return;
                    const base = (d.file_name ?? "descricao").replace(
                      /\.[^.]+$/,
                      "",
                    );
                    const r = await exportarMatriculaXlsx(
                      {
                        label: parcel.label,
                        area_m2: parcel.area_m2,
                        declared_perimeter_m: parcel.declared_perimeter_m,
                        computed_perimeter_m: parcel.computed_perimeter_m,
                        vertex_count: parcel.vertex_count,
                        raw_extraction: parcel.raw_extraction,
                        segments: (parcel.segments ?? []) as never,
                      },
                      `descricao-matricula-${base}.xlsx`,
                    );
                    toast.success(
                      r.sigef
                        ? `Descrição para matrícula gerada: ${r.linhas} vértices e ${r.confrontacoes} confrontação(ões).`
                        : `Descrição para matrícula gerada com ${r.linhas} linhas.`,
                    );
                  };
                  const excluirDocumento = () => {
                    if (
                      confirm(
                        `Excluir definitivamente "${d.file_name ?? "documento"}" e seus dados extraídos?`,
                      )
                    )
                      excluirDoc.mutate(d.id);
                  };
                  return (
                    <AccordionItem key={d.id} value={d.id}>
                      <div className="flex w-full items-center gap-2">
                      <AccordionTrigger className="flex-1 text-left">
                        <div className="flex w-full flex-wrap items-center gap-3 pr-3">
                          <span className="font-display text-base">
                            {d.file_name ?? "Texto colado"}
                          </span>
                          <span
                            className={`eyebrow ${
                              d.document_category === "nao_classificado"
                                ? "text-warning"
                                : ""
                            }`}
                          >
                            {CATEGORIA_DOCUMENTO[d.document_category]}
                          </span>

                          {poligonosDe(d.id).length > 1 && (
                            <span className="eyebrow">
                              {poligonosDe(d.id).length} polígonos
                            </span>
                          )}

                          <span
                            className={`ml-auto rounded-sm border px-2 py-0.5 text-[11px] ${
                              d.status === "parsed"
                                ? TONE_CLASS["success"]
                                : d.status === "failed"
                                  ? TONE_CLASS["destructive"]
                                  : TONE_CLASS["muted"]
                            }`}
                          >
                            {STATUS_DOCUMENTO[d.status]}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        {parcel && (parcel.segments ?? []).length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={gerarMatricula}
                          >
                            Extrair texto para Matrícula
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          disabled={reprocessar.isPending}
                          onClick={() => reprocessar.mutate(d.id)}
                        >
                          Reprocessar análise
                        </Button>
                        {admin.data?.admin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                            disabled={excluirDoc.isPending}
                            onClick={excluirDocumento}
                          >
                            Excluir documento
                          </Button>
                        )}
                      </div>
                      </div>

                      <AccordionContent>
                        <div className="mb-4 flex flex-wrap items-center gap-3">
                          <Label className="text-xs">Natureza do documento</Label>
                          <Select
                            value={d.document_category}
                            onValueChange={(v) =>
                              alterarCategoria.mutate({
                                documentId: d.id,
                                categoria: v,
                              })
                            }
                          >
                            <SelectTrigger className="w-64">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(CATEGORIA_DOCUMENTO).map(
                                ([k, v]) => (
                                  <SelectItem key={k} value={k}>
                                    {v}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        {d.error_message && (
                          <p className="mb-4 rounded-sm border border-warning/50 bg-warning/10 p-3 text-xs text-foreground">
                            {d.error_message}
                          </p>
                        )}
                        {parcel ? (
                          <>
                            <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
                              {[
                                ["Área", `${fmtNum(parcel.area_m2)} m²`],
                                [
                                  "Perímetro declarado",
                                  `${fmtNum(parcel.declared_perimeter_m)} m`,
                                ],
                                [
                                  "Perímetro calculado",
                                  `${fmtNum(parcel.computed_perimeter_m)} m`,
                                ],
                                ["Vértices", String(parcel.vertex_count)],
                                [
                                  "Altitude (mín–máx)",
                                  parcel.altitude_min_m === null
                                    ? "—"
                                    : `${fmtNum(parcel.altitude_min_m, 2)} – ${fmtNum(parcel.altitude_max_m, 2)} m`,
                                ],
                                [
                                  "Altitude média",
                                  parcel.altitude_mean_m === null
                                    ? "—"
                                    : `${fmtNum(parcel.altitude_mean_m, 2)} m`,
                                ],
                              ].map(([k, v]) => (
                                <div key={k}>
                                  <dt className="eyebrow">{k}</dt>
                                  <dd className="numeric mt-1 text-sm text-foreground">
                                    {v}
                                  </dd>
                                </div>
                              ))}
                            </dl>

                            {parcel.segments && parcel.segments.length > 0 && (() => {
                              const verts = new Map<string, VertexCoordRow>();
                              const rawV = (
                                parcel.raw_extraction as {
                                  vertices?: VertexCoordRow[];
                                } | null
                              )?.vertices;
                              (Array.isArray(rawV) ? rawV : []).forEach((v) =>
                                verts.set(String(v.name).toUpperCase(), v),
                              );
                              const segs = [...parcel.segments].sort(
                                (x, y) => x.seq - y.seq,
                              );
                              const vDe = (s: (typeof segs)[number]) =>
                                verts.get(String(s.from_vertex ?? "").toUpperCase());
                              const temGeo = segs.some((s) => {
                                const v = vDe(s);
                                return v?.lat != null || v?.lon != null;
                              });
                              const temPlana = segs.some((s) => {
                                const v = vDe(s);
                                return v?.north != null || v?.east != null;
                              });
                              return (
                              <div className="mt-6 overflow-x-auto">
                                <table className="w-auto min-w-full table-auto border-collapse text-left text-xs [&_td]:whitespace-nowrap [&_td]:pr-4 [&_th]:whitespace-nowrap [&_th]:pr-4">
                                  <thead>
                                    <tr className="border-b border-border">
                                      {[
                                        "#",
                                        "TRECHO DE",
                                        "TRECHO PARA",
                                        ...(temGeo ? ["LONGITUDE", "LATITUDE"] : []),
                                        ...(temPlana
                                          ? ["COORD. N(Y)", "COORD. E(X)"]
                                          : []),
                                        "ALT. (m)",
                                        "ÂNGULO",
                                        "DIST. (m)",
                                        "CONFRONTANTE",
                                      ].map((h) => (
                                        <th
                                          key={h}
                                          className="eyebrow py-2 pr-3 font-normal"
                                        >
                                          {h}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {segs.map((s) => {
                                      const v = vDe(s);
                                      return (
                                        <tr
                                          key={s.id}
                                          className="border-b border-border/60"
                                        >
                                          <td className="numeric py-2 pr-3 text-muted-foreground">
                                            {s.seq}
                                          </td>
                                          <td className="numeric py-2 pr-3">
                                            {s.from_vertex ?? "—"}
                                          </td>
                                          <td className="numeric py-2 pr-3">
                                            {s.to_vertex ?? "—"}
                                          </td>
                                          {temGeo && (
                                            <>
                                              <td className="numeric py-2 pr-3">
                                                {coordToDms(v?.lon ?? null, "lon")}
                                              </td>
                                              <td className="numeric py-2 pr-3">
                                                {coordToDms(v?.lat ?? null, "lat")}
                                              </td>
                                            </>
                                          )}
                                          {temPlana && (
                                            <>
                                              <td className="numeric py-2 pr-3">
                                                {fmtMedida(v?.north ?? null)}
                                              </td>
                                              <td className="numeric py-2 pr-3">
                                                {fmtMedida(v?.east ?? null)}
                                              </td>
                                            </>
                                          )}
                                          <td className="numeric py-2 pr-3">
                                            {fmtMedida(s.altitude_from_m ?? v?.alt ?? null)}
                                          </td>
                                          <td className="numeric py-2 pr-3">
                                            {anguloLiteral(
                                              s.bearing_text,
                                              s.azimuth_deg,
                                            )}
                                          </td>
                                          <td className="numeric py-2 pr-3">
                                            {fmtMedida(s.distance_m)}
                                          </td>
                                          <td className="py-2 pr-3 text-muted-foreground">
                                            {s.confrontante ?? "—"}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              );
                            })()}
                          </>

                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Nenhum dado técnico extraído deste documento.
                          </p>
                        )}
                        <div className="mt-5 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={reprocessar.isPending}
                            onClick={() => reprocessar.mutate(d.id)}
                          >
                            Reprocessar extração
                          </Button>
                          {admin.data?.admin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={excluirDoc.isPending}
                              className="text-muted-foreground hover:text-destructive"
                              onClick={excluirDocumento}
                            >
                              Excluir documento
                            </Button>
                          )}

                          {parcel && (parcel.segments ?? []).length > 0 && (
                            <>
                              <Button size="sm" onClick={gerarMatricula}>
                                Gerar descrição para Matrícula
                              </Button>
                              {(["kml", "kmz", "dwg"] as const).map((formato) => (
                                <Button key={formato} variant="outline" size="sm" onClick={() => void exportarGeometria(formato)}>
                                  Exportar em {formato.toUpperCase()}
                                </Button>
                              ))}
                            </>
                          )}

                        </div>


                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </section>
        </TabsContent>

        {/* ---------------- COMPARAÇÕES ---------------- */}
        <TabsContent value="comparacoes" className="mt-6 space-y-8">
          <section className="panel p-6">
            <h2 className="text-xl">Nova comparação</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Somente documentos com extração concluída podem ser comparados.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <div className="flex h-6 items-center">
                  <Label>Documento A (paradigma)</Label>
                </div>

                <Select
                  value={docA}
                  onValueChange={(v) => {
                    setDocA(v);
                    setParcelA("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {extraidos.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.file_name ?? "Texto colado"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {poligonosDe(docA).length > 1 && (
                  <Select value={parcelA} onValueChange={setParcelA}>
                    <SelectTrigger>
                      <SelectValue placeholder="Polígono (1º por padrão)" />
                    </SelectTrigger>
                    <SelectContent>
                      {poligonosDe(docA).map((p, i) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label ?? `Polígono ${i + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex h-6 items-center justify-between gap-2">
                  <Label>Tipo de comparação</Label>

                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="O que cada critério faz?"
                      >
                        <HelpCircle className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Critérios de comparação</DialogTitle>
                        <DialogDescription>
                          Escolha o modo conforme a natureza dos documentos que
                          serão confrontados.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="mt-2 space-y-4 text-sm">
                        <div className="space-y-2">
                          <h4 className="font-medium">
                            {TIPO_COMPARACAO["memorial_to_memorial"]}
                          </h4>
                          <p className="text-muted-foreground">
                            Confronta dois memoriais descritivos: azimutes/rumbos,
                            distâncias, cotas, área, perímetro, confrontantes e
                            sequência de vértices.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <h4 className="font-medium">
                            {TIPO_COMPARACAO["memorial_to_plan"]}
                          </h4>
                          <p className="text-muted-foreground">
                            Compara a descrição textual do memorial com a
                            geometria da planta (medidas, ângulos e
                            confrontantes).
                          </p>
                        </div>
                        <div className="space-y-2">
                          <h4 className="font-medium">
                            {TIPO_COMPARACAO["plan_to_plan"]}
                          </h4>
                          <p className="text-muted-foreground">
                            Confronta geometria vetorial/gráfica entre duas
                            plantas.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <h4 className="font-medium">
                            {TIPO_COMPARACAO["memorial_to_title"]}
                          </h4>
                          <p className="text-muted-foreground">
                            Compara o memorial com a descrição contida em uma
                            escritura ou outro título dominial.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <h4 className="font-medium">
                            {TIPO_COMPARACAO["memorial_to_registry"]}
                          </h4>
                          <p className="text-muted-foreground">
                            Compara o memorial com os dados de uma matrícula.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <h4 className="font-medium">
                            {TIPO_COMPARACAO["boundary_to_boundary"]}
                          </h4>
                          <p className="text-muted-foreground">
                            Modo vizinhos: confere apenas o trecho de divisa
                            compartilhada (distâncias, azimutes e cotas),
                            ignorando nomes de vértices, área, perímetro total e
                            reciprocidade de confrontantes. Pode ser usado com um
                            único documento — basta indicar os polígonos no
                            paradigma e no comparável.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <h4 className="font-medium">{TIPO_COMPARACAO["custom"]}</h4>
                          <p className="text-muted-foreground">
                            Permite adicionar quantos documentos comparáveis
                            quiser (B, C, D…), de categorias iguais ou diferentes.
                            Todos são conferidos contra o mesmo paradigma e o
                            resultado abre na tabela única “Conferência
                            consolidada”, com cada documento empilhado na sua
                            cor.
                          </p>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TIPO_COMPARACAO).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tipo === "boundary_to_boundary" ? (
                  <p className="text-xs text-muted-foreground">
                    Modo vizinhos: confere apenas o trecho de divisa compartilhado
                    (distâncias, azimutes e cotas), ignorando nomes de vértices,
                    área, perímetro total e reciprocidade de confrontantes. Um
                    único documento que descreva todos os polígonos envolvidos
                    pode ser escolhido no paradigma e no comparável — basta
                    indicar os polígonos.
                  </p>
                ) : null}
                {tipo === "custom" ? (
                  <p className="text-xs text-muted-foreground">
                    Comparação múltipla: adicione quantos documentos comparáveis
                    quiser (B, C, D…). Todos são conferidos contra o mesmo
                    paradigma e o resultado abre já na tabela única
                    “Conferência consolidada”, com cada documento empilhado na
                    sua cor.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base">Documentos comparáveis</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setComparaveis((lista) => [...lista, { doc: "", parcel: "" }])
                  }
                >
                  + Adicionar documento
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Cada documento comparável (B, C, D…) é confrontado com o
                documento paradigma, gerando uma comparação própria.
              </p>

              <div className="mt-4 space-y-4">
                {comparaveis.map((c, i) => (
                  <div
                    key={i}
                    className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start"
                  >
                    <div className="space-y-2">
                      <Label>
                        Documento {String.fromCharCode(66 + i)}
                      </Label>
                      <Select
                        value={c.doc}
                        onValueChange={(v) =>
                          setComparaveis((lista) =>
                            lista.map((item, j) =>
                              j === i ? { doc: v, parcel: "" } : item,
                            ),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {extraidos.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.file_name ?? "Texto colado"}
                              {d.id === docA && poligonosDe(d.id).length > 1
                                ? " (mesmo documento)"
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {poligonosDe(c.doc).length > 1 && (
                        <Select
                          value={c.parcel}
                          onValueChange={(v) =>
                            setComparaveis((lista) =>
                              lista.map((item, j) =>
                                j === i ? { ...item, parcel: v } : item,
                              ),
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Polígono (2º por padrão)" />
                          </SelectTrigger>
                          <SelectContent>
                            {poligonosDe(c.doc).map((p, k) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.label ?? `Polígono ${k + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="md:mt-7"
                      disabled={comparaveis.length === 1}
                      onClick={() =>
                        setComparaveis((lista) =>
                          lista.filter((_, j) => j !== i),
                        )
                      }
                    >
                      − Excluir
                    </Button>
                  </div>
                ))}
              </div>
            </div>



            <h3 className="mt-8 text-base">Tolerâncias técnicas</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2">
                <div className="grid grid-cols-[minmax(5.5rem,0.65fr)_minmax(0,2fr)] gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="areaPct">Área (%)</Label>
                    <Input
                      id="areaPct"
                      type="number"
                      step={0.01}
                      min={0}
                      value={tol.areaPct}
                      onChange={(e) =>
                        setTol({ ...tol, areaPct: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="areaM2">
                      Área ({unidadeArea === "ha" ? "ha" : "m²"})
                    </Label>
                    <div className="grid grid-cols-[minmax(0,1fr)_4rem] gap-2">
                      <Input
                        id="areaM2"
                        type="number"
                        step={unidadeArea === "ha" ? 0.0001 : 0.01}
                        min={0}
                        className="min-w-0"
                        value={
                          unidadeArea === "ha" ? tol.areaM2 / 10000 : tol.areaM2
                        }
                        onChange={(e) =>
                          setTol({
                            ...tol,
                            areaM2:
                              Number(e.target.value) *
                              (unidadeArea === "ha" ? 10000 : 1),
                          })
                        }
                      />
                      <Select
                        value={unidadeArea}
                        onValueChange={(v) => setUnidadeArea(v as "m2" | "ha")}
                      >
                        <SelectTrigger className="w-16 px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="m2">m²</SelectItem>
                          <SelectItem value="ha">ha</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>

              {(
                [
                  ["perimeterPct", "Perímetro (%)", 0.01],
                  ["perimeterM", "Perímetro (m)", 0.001],
                  ["azimuthDeg", "Azimute (°)", 0.0001],
                  ["altitudeM", "Altitude (m)", 0.01],
                  ["distanceM", "Distância (m)", 0.001],
                ] as const
              ).map(([key, label, step]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={key}>{label}</Label>
                  <Input
                    id={key}
                    type="number"
                    step={step}
                    min={0}
                    value={tol[key]}
                    onChange={(e) =>
                      setTol({ ...tol, [key]: Number(e.target.value) })
                    }
                  />
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Área e perímetro conferem quando a diferença fica dentro do
              percentual <em>ou</em> da medida absoluta informada.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Checkbox
                id="ignoreConfrontations"
                checked={tol.ignoreConfrontations ?? false}
                onCheckedChange={(checked) =>
                  setTol((atual) => ({ ...atual, ignoreConfrontations: checked === true }))
                }
              />
              <Label htmlFor="ignoreConfrontations" className="cursor-pointer">
                Ignorar confrontações
              </Label>
            </div>


            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                disabled={executarComparacao.isPending}
                onClick={() => executarComparacao.mutate()}
              >
                {executarComparacao.isPending
                  ? "Comparando..."
                  : "Executar comparação"}
              </Button>

              {tipo === "memorial_to_plan" && (
                <Button
                  variant="outline"
                  disabled={conferirLotes.isPending}
                  onClick={() => conferirLotes.mutate()}
                >
                  {conferirLotes.isPending
                    ? "Conferindo lote a lote..."
                    : "Conferência de Loteamentos — memorial e planta"}
                </Button>
              )}
            </div>

            {tipo === "memorial_to_plan" && (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Na conferência lote a lote, cada figura do memorial (quadra e
                lote, áreas públicas) é pareada com a mesma figura da planta pelo
                rótulo. A planta é representação gráfica: a medida que ela não
                traz não é apontada como erro; a medida que ela traz precisa
                coincidir com a do memorial. Documento A = memorial, documento B
                = planta.
              </p>
            )}

          </section>

          <section>
            <h2 className="text-xl">Comparações realizadas</h2>
            {(comparisons.data ?? []).length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Nenhuma comparação registrada.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {comparisons.data!.map((c) => {
                  const cls = CLASSIFICACAO[c.classification ?? "inconclusive"]!;
                  return (
                    <li key={c.id} className="flex items-start gap-2">
                      <Link
                        to="/comparacoes/$id"
                        params={{ id: c.id }}
                        className="panel block flex-1 p-5 transition-colors hover:border-accent"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-display text-base">
                            {TIPO_COMPARACAO[c.comparison_type]}
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
                        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                          {c.summary}
                        </p>
                      </Link>
                      {admin.data?.admin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={excluirComp.isPending}
                          className="mt-1 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Excluir esta comparação? A exclusão será registrada na trilha de auditoria.",
                              )
                            )
                              excluirComp.mutate(c.id);
                          }}
                        >
                          Excluir
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </TabsContent>

        {/* ---------------- AUDITORIA ---------------- */}
        <TabsContent value="auditoria" className="mt-6">
          <h2 className="text-xl">Trilha de processamento</h2>
          <ul className="mt-4 space-y-2">
            {(auditoria.data ?? []).map((log) => (
              <li
                key={log.id}
                className="flex flex-wrap items-center gap-3 border-b border-border py-3 text-sm"
              >
                <span className="numeric text-xs text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("pt-BR")}
                </span>
                <span className="eyebrow">{log.entity_type}</span>
                <span className="text-foreground">{log.action}</span>
              </li>
            ))}
            {(auditoria.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum evento registrado ainda.
              </p>
            )}
          </ul>
        </TabsContent>
      </Tabs>
    </main>
  );
}
