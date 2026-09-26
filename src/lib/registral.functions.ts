import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isGeoExtension } from "./geo-parser";
import { parseParcelas, descricoesEmProsa, semDescricaoPerimetrica } from "./multi-parcel";
import {
  DEFAULT_TOLERANCES,
  compareParcels,
  compareSharedBoundary,
  compareMemorialToPlan,
  type ParcelInput,
  type Tolerances,
} from "./comparison-engine";
import { parearFiguras } from "./lote-key";
import {
  compararLoteComBloco,
  extrairBlocosCotados,
  parearPorArea,
} from "./planta-cotas";


const ProcessInput = z.object({ documentId: z.string().uuid() });

export const processDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProcessInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: doc, error } = await supabase
      .from("documents")
      .select("*")
      .eq("id", data.documentId)
      .single();
    if (error || !doc) throw new Error("Documento não encontrado.");

    let text = doc.original_text ?? "";
    let note: string | undefined;
    let usage: { model: string; promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    if (!text && doc.storage_path) {
      const { data: file, error: dlError } = await supabase.storage
        .from("documentos")
        .download(doc.storage_path);
      if (dlError || !file) throw new Error("Falha ao ler o arquivo armazenado.");
      const { extractTextFromFile } = await import("./extraction.server");
      const result = await extractTextFromFile(
        await file.arrayBuffer(),
        doc.file_extension ?? "",
      );
      text = result.text;
      note = result.note;
      usage = result.usage;
    }

    if (doc.source_document_id && !doc.original_text) {
      throw new Error("Trecho sem texto extraído. Reprocesse o documento original.");
    }

    await registrarConsumo(supabase, {
      analysisId: doc.analysis_id,
      documentId: doc.id,
      userId,
      fileName: doc.file_name,
      fileExtension: doc.file_extension,
      fileSizeBytes: doc.file_size_bytes,
      usage,
      note,
    });

    if (!text.trim()) {
      await supabase
        .from("documents")
        .update({
          status: "failed",
          error_message: note ?? "Nenhum texto pôde ser extraído.",
        })
        .eq("id", doc.id);
      return { ok: false as const, message: note ?? "Nenhum texto pôde ser extraído." };
    }

    const ehGeometria =
      isGeoExtension(doc.file_extension) ||
      text.trimStart().startsWith("<kml") ||
      text.includes("<coordinates>");

    const encontradas = parseParcelas(text, ehGeometria);
    const parcelas = doc.source_document_id && doc.source_parcel_index !== null && encontradas.length > 1
      ? encontradas.slice(doc.source_parcel_index, doc.source_parcel_index + 1)
      : encontradas;
    if (parcelas.length === 0) {
      const msg = semDescricaoPerimetrica(text)
        ? "O arquivo não contém descrição perimétrica legível — o texto extraído é de uma planta plotada em CAD (rótulos de grade e legendas). Envie o memorial descritivo correspondente ou a geometria vetorial (KML, KMZ, GeoJSON) da planta."
        : "Nenhum polígono reconhecido.";
      await supabase
        .from("documents")
        .update({ status: "failed", error_message: msg })
        .eq("id", doc.id);
      return { ok: false as const, message: msg };
    }

    if (ehGeometria) {
      parcelas.forEach((p) => {
        p.warnings = [
          "Geometria vetorial interpretada: azimutes e distâncias calculados sobre WGS-84.",
          ...p.warnings,
        ];
      });
    }

    // Um arquivo-fonte pode conter vários perímetros; cada descrição recebe um
    // documento próprio para classificação e comparação independentes.
    let destinos: string[] = [];
    if (parcelas.length > 1 && !doc.source_document_id) {
      const trechos = ehGeometria ? [] : descricoesEmProsa(text);
      const { data: existentes, error: existingError } = await supabase
        .from("documents")
        .select("id, source_parcel_index")
        .eq("source_document_id", doc.id);
      if (existingError) throw new Error(existingError.message);
      for (const [index, parsed] of parcelas.entries()) {
        const anterior = existentes?.find((d) => d.source_parcel_index === index);
        const nome = `${(doc.file_name ?? "Documento").replace(/\.[^.]+$/, "")} — ${parsed.label ?? `Trecho ${index + 1}`}`.slice(0, 255);
        const textoTrecho = trechos.length === parcelas.length ? trechos[index]?.texto : null;
        if (anterior) {
          const { error: updateError } = await supabase.from("documents")
            .update({ original_text: textoTrecho ?? text.slice(0, 200000), status: "uploaded" })
            .eq("id", anterior.id);
          if (updateError) throw new Error(updateError.message);
        } else {
          const { error: insertError } = await supabase.from("documents").insert({
            analysis_id: doc.analysis_id,
            source_document_id: doc.id,
            source_parcel_index: index,
            source_type: doc.source_type,
            file_name: nome,
            file_extension: doc.file_extension,
            original_text: textoTrecho ?? text.slice(0, 200000),
            document_category: "nao_classificado",
            created_by: userId,
          });
          if (insertError) throw new Error(insertError.message);
        }
      }
      // O original é guardado como fonte, sem competir com os documentos-filhos.
      await supabase.from("parcels").delete().eq("document_id", doc.id);
      const { error: sourceError } = await supabase.from("documents").update({
        status: "parsed", extracted_text: text.slice(0, 200000), error_message: note ?? null,
      }).eq("id", doc.id);
      if (sourceError) throw new Error(sourceError.message);
      const { data: filhos, error: childrenError } = await supabase.from("documents")
        .select("id").eq("source_document_id", doc.id).order("source_parcel_index");
      if (childrenError || !filhos) throw new Error("Falha ao listar os trechos separados.");
      for (const filho of filhos) {
        // Cada filho é processado sem baixar o PDF novamente (nem repetir OCR).
        const { error: deleteError } = await supabase.from("parcels").delete().eq("document_id", filho.id);
        if (deleteError) throw new Error(deleteError.message);
      }
      // A persistência das parcelas usa o ID de cada filho abaixo.
      destinos = filhos.map((f) => f.id);
    }

    if (destinos.length === 0) {
      const { error: deleteError } = await supabase.from("parcels").delete().eq("document_id", doc.id);
      if (deleteError) throw new Error(deleteError.message);
    }

    for (const [index, parsed] of parcelas.entries()) {
      const destinoId = destinos?.[index] ?? doc.id;
      const { data: parcel, error: parcelError } = await supabase
        .from("parcels")
        .insert({
          document_id: destinoId,
          analysis_id: doc.analysis_id,
          label: parsed.label,
          area_m2: parsed.area_m2,
          declared_perimeter_m: parsed.declared_perimeter_m,
          computed_perimeter_m: parsed.computed_perimeter_m,
          vertex_count: parsed.vertex_count,
          altitude_min_m: parsed.altitude_min_m,
          altitude_max_m: parsed.altitude_max_m,
          altitude_mean_m: parsed.altitude_mean_m,
          confrontantes: parsed.confrontantes,
          raw_extraction: { warnings: parsed.warnings, vertices: parsed.vertices },
        })
        .select("id")
        .single();
      if (parcelError || !parcel) throw new Error("Falha ao registrar a extração.");

      if (parsed.segments.length > 0) {
        const { error: segError } = await supabase.from("segments").insert(
          parsed.segments.map((s) => ({
            parcel_id: parcel.id,
            analysis_id: doc.analysis_id,
            seq: s.seq,
            from_vertex: s.from_vertex,
            to_vertex: s.to_vertex,
            bearing_text: s.bearing_text,
            azimuth_deg: s.azimuth_deg,
            distance_m: s.distance_m,
            altitude_from_m: s.altitude_from_m,
            altitude_to_m: s.altitude_to_m,
            confrontante: s.confrontante,
            raw_text: s.raw_text,
          })),
        );
        if (segError) throw new Error("Falha ao registrar os segmentos.");
      }
    }

    const avisos: string[] = [...new Set(parcelas.flatMap((p) => p.warnings))];
    const totalSegmentos = parcelas.reduce((acc, p) => acc + p.segments.length, 0);

    await supabase
      .from("documents")
      .update({
        status: "parsed",
        extracted_text: text.slice(0, 200000),
        error_message: note ?? null,
      })
      .eq("id", doc.id);

    if (destinos?.length) {
      const { error: childStatusError } = await supabase.from("documents")
        .update({ status: "parsed", error_message: null }).in("id", destinos);
      if (childStatusError) throw new Error(childStatusError.message);
    }

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      entity_type: "document",
      entity_id: doc.id,
      action: "extract",
      metadata: {
        poligonos: parcelas.length,
        segmentos: totalSegmentos,
        area_m2: parcelas[0]?.area_m2 ?? null,
        avisos,
      },
    });

    return {
      ok: true as const,
      segments: totalSegmentos,
      parcels: parcelas.length,
      warnings: avisos,
      note,
    };
  });


type ConsumoInput = {
  analysisId: string;
  documentId: string;
  userId: string;
  fileName: string | null;
  fileExtension: string | null;
  fileSizeBytes: number | null;
  usage?: { model: string; promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  note?: string | undefined;
};

async function registrarConsumo(
  supabase: SupabaseClient<Database>,
  input: ConsumoInput,
) {
  const { creditosDeTokens, estimarPaginas } = await import("./credit-estimator");
  const ext = (input.fileExtension ?? "").toLowerCase().replace(".", "");
  const ocrUsed = Boolean(input.usage);
  await supabase.from("ai_usage_events").insert({
    analysis_id: input.analysisId,
    document_id: input.documentId,
    user_id: input.userId,
    operation: "extracao_documento",
    model: input.usage?.model ?? "",
    ocr_used: ocrUsed,
    file_name: input.fileName,
    file_extension: ext || null,
    file_size_bytes: input.fileSizeBytes,
    pages_estimated: ocrUsed ? estimarPaginas(ext, input.fileSizeBytes ?? 0) : 0,
    prompt_tokens: input.usage?.promptTokens ?? 0,
    completion_tokens: input.usage?.completionTokens ?? 0,
    total_tokens: input.usage?.totalTokens ?? 0,
    credits_estimated: ocrUsed ? creditosDeTokens(input.usage?.totalTokens ?? 0) : 0,
    note: input.note ?? null,
  });
}

const CompareInput = z.object({
  analysisId: z.string().uuid(),
  documentAId: z.string().uuid(),
  documentBId: z.string().uuid(),
  // Polígonos específicos: obrigatório quando o mesmo documento descreve
  // vários imóveis (divisa comum conferida dentro de um único documento).
  parcelAId: z.string().uuid().optional(),
  parcelBId: z.string().uuid().optional(),

  comparisonType: z.enum([
    "memorial_to_memorial",
    "memorial_to_plan",
    "plan_to_plan",
    "memorial_to_title",
    "boundary_to_boundary",
    "memorial_to_registry",
    "custom",
  ]),
  tolerances: z
    .object({
      areaPct: z.number().min(0).max(100),
      perimeterPct: z.number().min(0).max(100),
      distanceM: z.number().min(0).max(1000),
      azimuthDeg: z.number().min(0).max(180),
      altitudeM: z.number().min(0).max(10000),
      areaM2: z.number().min(0).default(0),
      perimeterM: z.number().min(0).default(0),
    })
    .optional(),
});

export const runComparison = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CompareInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tol: Tolerances = data.tolerances ?? DEFAULT_TOLERANCES;

    async function loadParcel(
      documentId: string,
      parcelId?: string,
      excluirParcelId?: string,
    ): Promise<{
      parcel: ParcelInput;
      parcelId: string;
      label: string;
    } | null> {
      const { data: doc } = await supabase
        .from("documents")
        .select("id, file_name, source_type")
        .eq("id", documentId)
        .single();
      let query = supabase
        .from("parcels")
        .select("*")
        .eq("document_id", documentId)
        .order("created_at");
      if (parcelId) query = query.eq("id", parcelId);
      else if (excluirParcelId) query = query.neq("id", excluirParcelId);
      const { data: parcelas } = await query.limit(1);
      const parcel = parcelas?.[0];
      if (!parcel) return null;
      const { data: segments } = await supabase
        .from("segments")
        .select("*")
        .eq("parcel_id", parcel.id)
        .order("seq");
      const nomeDoc = doc?.file_name ?? "Texto colado";
      return {
        parcelId: parcel.id,
        label: parcel.label ? `${nomeDoc} — ${parcel.label}` : nomeDoc,
        parcel: {
          label: parcel.label,
          area_m2: parcel.area_m2 === null ? null : Number(parcel.area_m2),
          declared_perimeter_m:
            parcel.declared_perimeter_m === null
              ? null
              : Number(parcel.declared_perimeter_m),
          computed_perimeter_m:
            parcel.computed_perimeter_m === null
              ? null
              : Number(parcel.computed_perimeter_m),
          vertex_count: parcel.vertex_count,
          altitude_min_m:
            parcel.altitude_min_m === null ? null : Number(parcel.altitude_min_m),
          altitude_max_m:
            parcel.altitude_max_m === null ? null : Number(parcel.altitude_max_m),
          altitude_mean_m:
            parcel.altitude_mean_m === null ? null : Number(parcel.altitude_mean_m),
          confrontantes: parcel.confrontantes ?? [],
          segments: (segments ?? []).map((s) => ({
            seq: s.seq,
            from_vertex: s.from_vertex,
            to_vertex: s.to_vertex,
            azimuth_deg: s.azimuth_deg === null ? null : Number(s.azimuth_deg),
            bearing_text: s.bearing_text,
            distance_m: s.distance_m === null ? null : Number(s.distance_m),
            altitude_from_m:
              s.altitude_from_m === null ? null : Number(s.altitude_from_m),
            altitude_to_m:
              s.altitude_to_m === null ? null : Number(s.altitude_to_m),
            confrontante: s.confrontante,
          })),
        },
      };
    }

    const mesmoDocumento = data.documentAId === data.documentBId;
    if (mesmoDocumento && data.comparisonType !== "boundary_to_boundary") {
      throw new Error(
        "Comparar um documento com ele mesmo só é possível no modo divisa comum entre vizinhos.",
      );
    }
    if (mesmoDocumento && data.parcelAId && data.parcelAId === data.parcelBId) {
      throw new Error("Selecione dois polígonos distintos do documento.");
    }

    const a = await loadParcel(data.documentAId, data.parcelAId);
    const b = await loadParcel(
      data.documentBId,
      data.parcelBId,
      mesmoDocumento && !data.parcelBId ? a?.parcelId : undefined,
    );
    if (mesmoDocumento && a && !b) {
      throw new Error(
        "Este documento descreve apenas um polígono. Para conferir a divisa comum dentro de um único documento, ele precisa trazer a descrição perimétrica de todos os imóveis envolvidos.",
      );
    }
    if (!a || !b) {
      throw new Error(
        "Ambos os documentos precisam ter extração concluída antes da comparação.",
      );
    }
    if (a.parcelId === b.parcelId) {
      throw new Error("Selecione dois polígonos distintos.");
    }


    // Divisa comum entre vizinhos: imóveis distintos, confere-se só o trecho
    // compartilhado (sem área, perímetro total ou reciprocidade de confrontantes).
    const result =
      data.comparisonType === "boundary_to_boundary"
        ? compareSharedBoundary(a.parcel, b.parcel, tol, {
            a: a.label,
            b: b.label,
          })
        : compareParcels(a.parcel, b.parcel, tol, {
            a: a.label,
            b: b.label,
          });

    const { data: comparison, error } = await supabase
      .from("comparisons")
      .insert({
        analysis_id: data.analysisId,
        comparison_type: data.comparisonType,
        status: "completed",
        classification: result.classification,
        document_a_id: data.documentAId,
        document_b_id: data.documentBId,
        tolerances: tol,
        summary: result.summary,
        metrics: result.metrics as unknown as Json,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !comparison) throw new Error("Falha ao registrar a comparação.");

    if (result.findings.length > 0) {
      await supabase.from("findings").insert(
        result.findings.map((f) => ({
          comparison_id: comparison.id,
          analysis_id: data.analysisId,
          severity: f.severity,
          code: f.code,
          title: f.title,
          description: f.description,
          evidence: f.evidence as unknown as Json,
        })),
      );
    }

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      entity_type: "comparison",
      entity_id: comparison.id,
      action: "run",
      metadata: { classificacao: result.classification, tolerancias: tol },
    });

    return { comparisonId: comparison.id, classification: result.classification };
  });

const BatchInput = z.object({
  analysisId: z.string().uuid(),
  memorialDocumentId: z.string().uuid(),
  plantaDocumentId: z.string().uuid(),
  tolerances: z
    .object({
      areaPct: z.number().min(0).max(100),
      perimeterPct: z.number().min(0).max(100),
      distanceM: z.number().min(0).max(1000),
      azimuthDeg: z.number().min(0).max(180),
      altitudeM: z.number().min(0).max(10000),
      areaM2: z.number().min(0).default(0),
      perimeterM: z.number().min(0).default(0),
    })
    .optional(),
});

/**
 * Confere, lote a lote (e quadra a quadra), o memorial contra a planta:
 * as figuras são pareadas pelo rótulo e só as medidas cotadas na planta
 * são confrontadas.
 */
export const runLotBatchComparison = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BatchInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tol: Tolerances = data.tolerances ?? DEFAULT_TOLERANCES;

    if (data.memorialDocumentId === data.plantaDocumentId) {
      throw new Error("Selecione o memorial e a planta em documentos distintos.");
    }

    const { data: docs } = await supabase
      .from("documents")
      .select("id, file_name")
      .in("id", [data.memorialDocumentId, data.plantaDocumentId]);
    const nomeDoc = (id: string) =>
      docs?.find((d) => d.id === id)?.file_name ?? "Documento";

    const { data: parcelas } = await supabase
      .from("parcels")
      .select("*")
      .in("document_id", [data.memorialDocumentId, data.plantaDocumentId])
      .order("created_at");
    const todas = parcelas ?? [];
    if (todas.length === 0) {
      throw new Error("Os dois documentos precisam ter extração concluída.");
    }

    const { data: segmentos } = await supabase
      .from("segments")
      .select("*")
      .in(
        "parcel_id",
        todas.map((p) => p.id),
      )
      .order("seq");
    const porParcela = new Map<string, ParcelInput["segments"]>();
    (segmentos ?? []).forEach((s) => {
      const lista = porParcela.get(s.parcel_id) ?? [];
      lista.push({
        seq: s.seq,
        from_vertex: s.from_vertex,
        to_vertex: s.to_vertex,
        azimuth_deg: s.azimuth_deg === null ? null : Number(s.azimuth_deg),
        bearing_text: s.bearing_text,
        distance_m: s.distance_m === null ? null : Number(s.distance_m),
        altitude_from_m: s.altitude_from_m === null ? null : Number(s.altitude_from_m),
        altitude_to_m: s.altitude_to_m === null ? null : Number(s.altitude_to_m),
        confrontante: s.confrontante,
      });
      porParcela.set(s.parcel_id, lista);
    });

    const montar = (p: (typeof todas)[number]) => ({
      id: p.id,
      label: p.label,
      parcel: {
        label: p.label,
        area_m2: p.area_m2 === null ? null : Number(p.area_m2),
        declared_perimeter_m:
          p.declared_perimeter_m === null ? null : Number(p.declared_perimeter_m),
        computed_perimeter_m:
          p.computed_perimeter_m === null ? null : Number(p.computed_perimeter_m),
        vertex_count: p.vertex_count,
        altitude_min_m: p.altitude_min_m === null ? null : Number(p.altitude_min_m),
        altitude_max_m: p.altitude_max_m === null ? null : Number(p.altitude_max_m),
        altitude_mean_m: p.altitude_mean_m === null ? null : Number(p.altitude_mean_m),
        confrontantes: p.confrontantes ?? [],
        segments: porParcela.get(p.id) ?? [],
      } satisfies ParcelInput,
    });

    const listaMemorial = todas
      .filter((p) => p.document_id === data.memorialDocumentId)
      .map(montar);
    const listaPlanta = todas
      .filter((p) => p.document_id === data.plantaDocumentId)
      .map(montar);

    const pareamento = parearFiguras(listaMemorial, listaPlanta);

    // Contingência: plantas em CAD trazem só números soltos (cotas e área),
    // sem rótulo de quadra/lote. Nesse caso confere-se por área + cotas.
    if (pareamento.pares.length === 0) {
      const { data: docPlanta } = await supabase
        .from("documents")
        .select("extracted_text")
        .eq("id", data.plantaDocumentId)
        .maybeSingle();
      const blocos = extrairBlocosCotados(docPlanta?.extracted_text ?? "");
      const paresArea = parearPorArea(listaMemorial, blocos, tol.areaPct).slice(0, 400);

      if (paresArea.length === 0) {
        const exemplosMem = listaMemorial
          .map((m) => (m.label ?? "").slice(0, 40))
          .filter(Boolean)
          .slice(0, 3);
        throw new Error(
          `Não foi possível parear as figuras: os rótulos de quadra/lote não coincidem e a planta não traz áreas cotadas legíveis (${blocos.length} bloco(s) detectado(s)). Memorial: ${exemplosMem.join(" | ") || "sem rótulos"}.`,
        );
      }

      let divergentesA = 0;
      let conformesA = 0;
      for (const par of paresArea) {
        const resultado = compararLoteComBloco(par.memorial.parcel, par.bloco, tol, {
          a: `${nomeDoc(data.memorialDocumentId)} — ${par.memorial.label ?? "lote"}`,
          b: `${nomeDoc(data.plantaDocumentId)} — bloco cotado ${par.bloco.area_m2} m²`,
        });
        if (resultado.classification === "incompatible") divergentesA += 1;
        else if (resultado.classification === "compatible") conformesA += 1;

        const { data: comparacao, error } = await supabase
          .from("comparisons")
          .insert({
            analysis_id: data.analysisId,
            comparison_type: "memorial_to_plan",
            status: "completed",
            classification: resultado.classification,
            document_a_id: data.memorialDocumentId,
            document_b_id: data.plantaDocumentId,
            tolerances: tol,
            summary: `${(par.memorial.label ?? "Lote").slice(0, 60)}: ${resultado.summary}`,
            metrics: resultado.metrics as unknown as Json,
            created_by: userId,
          })
          .select("id")
          .single();
        if (error || !comparacao) throw new Error("Falha ao registrar a comparação.");

        if (resultado.findings.length > 0) {
          await supabase.from("findings").insert(
            resultado.findings.map((f) => ({
              comparison_id: comparacao.id,
              analysis_id: data.analysisId,
              severity: f.severity,
              code: f.code,
              title: `${(par.memorial.label ?? "Lote").slice(0, 40)} — ${f.title}`,
              description: f.description,
              evidence: f.evidence as unknown as Json,
            })),
          );
        }
      }

      await supabase.from("audit_logs").insert({
        actor_id: userId,
        entity_type: "analysis",
        entity_id: data.analysisId,
        action: "run_lot_batch",
        metadata: { modo: "cotas_avulsas", figuras: paresArea.length, divergentes: divergentesA },
      });

      return {
        figuras: paresArea.length,
        conformes: conformesA,
        divergentes: divergentesA,
        soNoMemorial: listaMemorial.length - paresArea.length,
        soNaPlanta: blocos.length - paresArea.length,
        modo: "cotas_avulsas" as const,
      };
    }


    const pares = pareamento.pares.slice(0, 400);
    let divergentes = 0;
    let conformes = 0;

    for (const par of pares) {
      const resultado = compareMemorialToPlan(par.a.parcel, par.b.parcel, tol, {
        a: `${nomeDoc(data.memorialDocumentId)} — ${par.a.label ?? par.chave}`,
        b: `${nomeDoc(data.plantaDocumentId)} — ${par.b.label ?? par.chave}`,
      });
      if (resultado.classification === "incompatible") divergentes += 1;
      else if (resultado.classification === "compatible") conformes += 1;

      const { data: comparacao, error } = await supabase
        .from("comparisons")
        .insert({
          analysis_id: data.analysisId,
          comparison_type: "memorial_to_plan",
          status: "completed",
          classification: resultado.classification,
          document_a_id: data.memorialDocumentId,
          document_b_id: data.plantaDocumentId,
          tolerances: tol,
          summary: `${par.a.label ?? par.chave}: ${resultado.summary}`,
          metrics: { ...resultado.metrics, figura: par.chave } as unknown as Json,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error || !comparacao) throw new Error("Falha ao registrar a comparação.");

      if (resultado.findings.length > 0) {
        await supabase.from("findings").insert(
          resultado.findings.map((f) => ({
            comparison_id: comparacao.id,
            analysis_id: data.analysisId,
            severity: f.severity,
            code: f.code,
            title: `${par.a.label ?? par.chave} — ${f.title}`,
            description: f.description,
            evidence: f.evidence as unknown as Json,
          })),
        );
      }
    }

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      entity_type: "analysis",
      entity_id: data.analysisId,
      action: "run_lot_batch",
      metadata: {
        figuras: pares.length,
        divergentes,
        so_no_memorial: pareamento.soNoA.length,
        so_na_planta: pareamento.soNoB.length,
      },
    });

    return {
      figuras: pares.length,
      conformes,
      divergentes,
      soNoMemorial: pareamento.soNoA.length,
      soNaPlanta: pareamento.soNoB.length,
    };
  });
