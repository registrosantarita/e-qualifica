import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  avaliarQualidadeOcr,
  extrairIndiceMatricula,
  identificarPaginaMatricula,
  type IndexPagina,
} from "./matricula-index-parser";

const arquivoEntrada = z.object({
  fileName: z.string().max(255),
  extension: z.string().max(12),
  base64: z.string(),
});

type PaginaPreparada = IndexPagina & {
  extension: string;
  texto: string;
  note?: string;
};

function agruparPaginas(paginas: PaginaPreparada[]) {
  const matriculasConhecidas = paginas.map((p) => p.matricula).filter((m): m is string => Boolean(m));
  const unica = [...new Set(matriculasConhecidas)].length === 1 ? matriculasConhecidas[0] : null;
  const grupos = new Map<string, PaginaPreparada[]>();
  for (const pagina of paginas) {
    const chave = pagina.matricula ?? unica ?? `sem-identificacao:${pagina.nome}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), pagina]);
  }
  return [...grupos.entries()].map(([matricula, itens]) => {
    const ordenadas = itens.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
    const semFolha = ordenadas.filter((p) => !p.folha).length;
    const podeInferirSequencia = ordenadas.length > 1 && semFolha > ordenadas.length / 2;
    const paginas = podeInferirSequencia
      ? ordenadas.map((pagina, indice) => ({
          ...pagina,
          folha: pagina.folha ?? `${Math.floor(indice / 2) + 1}${indice % 2 === 1 ? "V" : ""}`,
          ordem: pagina.ordem === 19998 ? indice + 1 : pagina.ordem,
          alertas: pagina.folha
            ? pagina.alertas
            : [...pagina.alertas, "Folha inferida pela ordem dos arquivos; confirme antes de salvar"],
        }))
      : ordenadas;
    return {
      matricula: matricula.startsWith("sem-identificacao:") ? null : matricula,
      paginas,
    };
  });
}

async function registrarUsoOcr(
  context: { userId: string; supabase: { from: (table: string) => any } },
  usage: import("./ocr.server").OcrUsage | undefined,
  fileName: string,
  extension: string,
) {
  if (!usage) return;
  const { creditosDeTokens } = await import("./credit-estimator");
  await context.supabase.from("ai_usage_events").insert({
    user_id: context.userId,
    operation: "checkindex_ocr",
    model: usage.model,
    ocr_used: true,
    file_name: fileName,
    file_extension: extension.replace(".", "").toLowerCase() || null,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    credits_estimated: creditosDeTokens(usage.totalTokens),
    note: "OCR de matrícula digitalizada (CheckIndex).",
  });
}

export const listarLotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("index_batches")
      .select("id, title, note, export_layout, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const criarLote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().trim().min(1).max(160),
        note: z.string().max(2000).default(""),
        exportLayout: z.enum(["csv_padrao", "xlsx_padrao", "json_padrao"]).default("csv_padrao"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("index_batches")
      .insert({
        title: data.title,
        note: data.note,
        export_layout: data.exportLayout,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Falha ao criar o lote.");
    return { id: row.id };
  });

export const excluirLote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("index_batches").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const obterLote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const [lote, registros] = await Promise.all([
      context.supabase.from("index_batches").select("*").eq("id", data.id).maybeSingle(),
      context.supabase
        .from("index_records")
        .select(
          "id, label, file_name, file_extension, source_type, tipo_livro, livro, matricula_numero, cns, data_abertura, ultima_ficha, ultimo_ato, registro_anterior, encerrada, matriculas_abertas, natureza, cep, tipo_logradouro, logradouro, numero_logradouro, bairro, lote, quadra, condominio, unidade, andar, bloco, tipo_rural, denominacao_rural, cim, certificacao, area_m2, area_hectare, perimetro_m, area_construida_m2, descricao, endereco, prenotacao, tipo_ato, ato, data_ato, selo, adquirente, conjuge_adq, transmitente, conjuge_transm, usufrutuario, conjuge_usu, outorgante, conjuge_outorgante, outorgado, conjuge_outorgado, credor, devedor, serviente, dominante, estado_civil, data_casamento, lei_casamento, reg_bens, pacto, email, telefone, identificacao, inscricao_estadual, situacao_titulares, cadastros, proprietarios, atos, onus, source_pages, field_evidence, corrections, ocr_quality, extraction_source, review_status, created_at",
        )
        .eq("batch_id", data.id)
        .order("created_at", { ascending: true }),
    ]);
    if (lote.error) throw new Error(lote.error.message);
    if (!lote.data) throw new Error("Lote não encontrado.");
    if (registros.error) throw new Error(registros.error.message);
    return { lote: lote.data, registros: registros.data ?? [] };
  });

export const prepararArquivosIndexacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ arquivos: z.array(arquivoEntrada).min(1).max(100), refazerOcr: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const paginas: PaginaPreparada[] = [];
    for (const arquivo of data.arquivos) {
      const bin = atob(arquivo.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      let resultado: Awaited<ReturnType<typeof import("./extraction.server")["extractTextFromFile"]>>;
      if (data.refazerOcr && /^(pdf|png|jpe?g|webp|tiff?)$/i.test(arquivo.extension)) {
        const { ocrDocument } = await import("./ocr.server");
        resultado = await ocrDocument(bytes.buffer.slice(0), arquivo.extension, arquivo.fileName);
      } else {
        const { extractTextFromFile } = await import("./extraction.server");
        resultado = await extractTextFromFile(bytes.buffer.slice(0), arquivo.extension);
      }
      await registrarUsoOcr(context, resultado.usage, arquivo.fileName, arquivo.extension);
      if (!resultado.text.trim()) throw new Error(resultado.note ?? `Nenhum texto foi encontrado em ${arquivo.fileName}.`);
      paginas.push({
        ...identificarPaginaMatricula(resultado.text, arquivo.fileName),
        extension: arquivo.extension,
        texto: resultado.text,
        ...(resultado.note ? { note: resultado.note } : {}),
      });
    }
    return agruparPaginas(paginas);
  });

export const indexarGruposMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      batchId: z.string().uuid(),
      grupos: z.array(z.object({
        matricula: z.string().nullable(),
        paginas: z.array(z.object({
          nome: z.string().max(255),
          extension: z.string().max(12),
          texto: z.string().max(500000),
          folha: z.string().nullable(),
          ordem: z.number(),
          qualidade: z.number(),
          alertas: z.array(z.string()),
        })).min(1),
      })).min(1),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ids: string[] = [];
    for (const grupo of data.grupos) {
      const paginas = [...grupo.paginas].sort((a, b) => a.ordem - b.ordem);
      const texto = paginas.map((p) => `\n=== ${p.nome} | FOLHA ${p.folha ?? "NÃO IDENTIFICADA"} ===\n${p.texto}`).join("\n");
      const dados = extrairIndiceMatricula(texto);
      const qualidade = avaliarQualidadeOcr(texto);
      const ultimaFicha = dados.ultima_ficha ?? paginas.at(-1)?.folha ?? null;
      const { data: row, error } = await context.supabase.from("index_records").insert({
        batch_id: data.batchId,
        label: grupo.matricula ? `Matrícula ${grupo.matricula}` : paginas.map((p) => p.nome).join(" + "),
        file_name: paginas.map((p) => p.nome).join("; ").slice(0, 255),
        file_extension: paginas.length === 1 ? paginas[0]?.extension ?? null : "pdf",
        source_type: "upload_grouped",
        tipo_livro: dados.tipo_livro, livro: dados.livro, matricula_numero: dados.matricula_numero,
        cns: dados.cns, data_abertura: dados.data_abertura, ultima_ficha: ultimaFicha,
        ultimo_ato: dados.ultimo_ato, registro_anterior: dados.registro_anterior,
        encerrada: dados.encerrada, matriculas_abertas: dados.matriculas_abertas, natureza: dados.natureza,
        cep: dados.cep, tipo_logradouro: dados.tipo_logradouro, logradouro: dados.logradouro,
        numero_logradouro: dados.numero_logradouro, bairro: dados.bairro, lote: dados.lote, quadra: dados.quadra,
        condominio: dados.condominio, unidade: dados.unidade, andar: dados.andar, bloco: dados.bloco,
        tipo_rural: dados.tipo_rural, denominacao_rural: dados.denominacao_rural, cim: dados.cadastros.cim,
        certificacao: dados.certificacao, area_m2: dados.area_m2, area_hectare: dados.area_hectare,
        perimetro_m: dados.perimetro_m, area_construida_m2: dados.area_construida_m2, descricao: dados.descricao,
        endereco: dados.endereco, prenotacao: dados.prenotacao, tipo_ato: dados.tipo_ato, ato: dados.ato,
        data_ato: dados.data_ato, selo: dados.selo, adquirente: dados.adquirente, conjuge_adq: dados.conjuge_adq,
        transmitente: dados.transmitente, conjuge_transm: dados.conjuge_transm, usufrutuario: dados.usufrutuario,
        conjuge_usu: dados.conjuge_usu, outorgante: dados.outorgante, conjuge_outorgante: dados.conjuge_outorgante,
        outorgado: dados.outorgado, conjuge_outorgado: dados.conjuge_outorgado, credor: dados.credor,
        devedor: dados.devedor, serviente: dados.serviente, dominante: dados.dominante,
        estado_civil: dados.estado_civil, data_casamento: dados.data_casamento, lei_casamento: dados.lei_casamento,
        reg_bens: dados.reg_bens, pacto: dados.pacto, email: dados.email, telefone: dados.telefone,
        identificacao: dados.identificacao, inscricao_estadual: dados.inscricao_estadual,
        situacao_titulares: dados.situacao_titulares, cadastros: JSON.parse(JSON.stringify(dados.cadastros)),
        proprietarios: JSON.parse(JSON.stringify(dados.proprietarios)), atos: JSON.parse(JSON.stringify(dados.atos)),
        onus: JSON.parse(JSON.stringify([...dados.onus, ...dados.onus_cancelados])),
        extracted: JSON.parse(JSON.stringify(dados)), source_pages: JSON.parse(JSON.stringify(paginas.map(({ texto: _texto, ...p }) => p))),
        field_evidence: JSON.parse(JSON.stringify(dados.evidencias)), ocr_quality: JSON.parse(JSON.stringify(qualidade)),
        corrections: {}, extraction_source: "deterministico_agrupado", raw_text: texto.slice(0, 400000),
        review_status: "pendente", created_by: context.userId,
      }).select("id").single();
      if (error || !row) throw new Error(error?.message ?? "Falha ao indexar a matrícula agrupada.");
      ids.push(row.id);
    }
    return { ids };
  });

export const indexarMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        batchId: z.string().uuid(),
        label: z.string().trim().max(120).default(""),
        fileName: z.string().max(255).optional(),
        extension: z.string().max(12).optional(),
        base64: z.string().optional(),
        texto: z.string().max(500000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let texto = (data.texto ?? "").trim();
    let note: string | undefined;

    if (!texto && data.base64) {
      const bin = atob(data.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const { extractTextFromFile } = await import("./extraction.server");
      const r = await extractTextFromFile(bytes.buffer, data.extension ?? "");
      texto = r.text ?? "";
      note = r.note;

      if (r.usage) {
        const { creditosDeTokens } = await import("./credit-estimator");
        await context.supabase.from("ai_usage_events").insert({
          user_id: context.userId,
          operation: "checkindex_ocr",
          model: r.usage.model,
          ocr_used: true,
          file_name: data.fileName ?? null,
          file_extension: (data.extension ?? "").replace(".", "").toLowerCase() || null,
          prompt_tokens: r.usage.promptTokens,
          completion_tokens: r.usage.completionTokens,
          total_tokens: r.usage.totalTokens,
          credits_estimated: creditosDeTokens(r.usage.totalTokens),
          note: "OCR de matrícula digitalizada (CheckIndex).",
        });
      }
    }

    if (!texto.trim()) throw new Error(note ?? "Nenhum texto pôde ser extraído deste documento.");

    const dados = extrairIndiceMatricula(texto);
    const { data: row, error } = await context.supabase
      .from("index_records")
      .insert({
        batch_id: data.batchId,
        label: data.label || data.fileName || `Matrícula ${dados.livro ?? ""}`.trim(),
        file_name: data.fileName ?? null,
        file_extension: (data.extension ?? "").replace(".", "").toLowerCase() || null,
        source_type: data.base64 ? "upload" : "pasted_text",
        tipo_livro: dados.tipo_livro,
        livro: dados.livro,
        matricula_numero: dados.matricula_numero,
        cns: dados.cns,
        data_abertura: dados.data_abertura,
        ultima_ficha: dados.ultima_ficha,
        ultimo_ato: dados.ultimo_ato,
        registro_anterior: dados.registro_anterior,
        encerrada: dados.encerrada,
        matriculas_abertas: dados.matriculas_abertas,
        natureza: dados.natureza,
        cep: dados.cep,
        tipo_logradouro: dados.tipo_logradouro,
        logradouro: dados.logradouro,
        numero_logradouro: dados.numero_logradouro,
        bairro: dados.bairro,
        lote: dados.lote,
        quadra: dados.quadra,
        condominio: dados.condominio,
        unidade: dados.unidade,
        andar: dados.andar,
        bloco: dados.bloco,
        tipo_rural: dados.tipo_rural,
        denominacao_rural: dados.denominacao_rural,
        cim: dados.cadastros.cim,
        certificacao: dados.certificacao,
        area_m2: dados.area_m2,
        area_hectare: dados.area_hectare,
        perimetro_m: dados.perimetro_m,
        area_construida_m2: dados.area_construida_m2,
        descricao: dados.descricao,
        endereco: dados.endereco,
        prenotacao: dados.prenotacao,
        tipo_ato: dados.tipo_ato,
        ato: dados.ato,
        data_ato: dados.data_ato,
        selo: dados.selo,
        adquirente: dados.adquirente,
        conjuge_adq: dados.conjuge_adq,
        transmitente: dados.transmitente,
        conjuge_transm: dados.conjuge_transm,
        usufrutuario: dados.usufrutuario,
        conjuge_usu: dados.conjuge_usu,
        outorgante: dados.outorgante,
        conjuge_outorgante: dados.conjuge_outorgante,
        outorgado: dados.outorgado,
        conjuge_outorgado: dados.conjuge_outorgado,
        credor: dados.credor,
        devedor: dados.devedor,
        serviente: dados.serviente,
        dominante: dados.dominante,
        estado_civil: dados.estado_civil,
        data_casamento: dados.data_casamento,
        lei_casamento: dados.lei_casamento,
        reg_bens: dados.reg_bens,
        pacto: dados.pacto,
        email: dados.email,
        telefone: dados.telefone,
        identificacao: dados.identificacao,
        inscricao_estadual: dados.inscricao_estadual,
        situacao_titulares: dados.situacao_titulares,

        cadastros: JSON.parse(JSON.stringify(dados.cadastros)),
        proprietarios: JSON.parse(JSON.stringify(dados.proprietarios)),
        atos: JSON.parse(JSON.stringify(dados.atos)),
        // Vigentes e cancelados no mesmo campo; o flag `vigente` separa os dois
        // na exportação e na tela de revisão.
        onus: JSON.parse(JSON.stringify([...dados.onus, ...dados.onus_cancelados])),
        extracted: JSON.parse(JSON.stringify(dados)),
        extraction_source: "deterministico",
        raw_text: texto.slice(0, 400000),
        review_status: "pendente",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Falha ao indexar a matrícula.");
    return { id: row.id, note };
  });

export const atualizarRegistro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        campos: z
          .object({
            tipo_livro: z.union([z.literal(2), z.literal(3)]).optional(),
            livro: z.string().max(40).nullable().optional(),
            matricula_numero: z.string().max(40).nullable().optional(),
            cns: z.string().max(30).nullable().optional(),
            data_abertura: z.string().max(10).nullable().optional(),
            ultima_ficha: z.string().max(20).nullable().optional(),
            ultimo_ato: z.string().max(20).nullable().optional(),
            registro_anterior: z.string().max(120).nullable().optional(),
            encerrada: z.boolean().optional(),
            matriculas_abertas: z.array(z.string().max(20)).max(200).optional(),
            natureza: z.enum(["urbano", "rural", "nao_identificado"]).optional(),
            cep: z.string().max(12).nullable().optional(),
            tipo_logradouro: z.string().max(40).nullable().optional(),
            logradouro: z.string().max(200).nullable().optional(),
            numero_logradouro: z.string().max(20).nullable().optional(),
            bairro: z.string().max(80).nullable().optional(),
            lote: z.string().max(20).nullable().optional(),
            quadra: z.string().max(20).nullable().optional(),
            condominio: z.string().max(120).nullable().optional(),
            unidade: z.string().max(20).nullable().optional(),
            andar: z.string().max(20).nullable().optional(),
            bloco: z.string().max(20).nullable().optional(),
            tipo_rural: z.string().max(40).nullable().optional(),
            denominacao_rural: z.string().max(200).nullable().optional(),
            cim: z.string().max(60).nullable().optional(),
            certificacao: z.string().max(80).nullable().optional(),
            area_m2: z.number().nullable().optional(),
            area_hectare: z.number().nullable().optional(),
            perimetro_m: z.number().nullable().optional(),
            area_construida_m2: z.number().nullable().optional(),
            descricao: z.string().max(4000).optional(),
            endereco: z.string().max(400).optional(),
            prenotacao: z.string().max(40).nullable().optional(),
            tipo_ato: z.string().max(6).nullable().optional(),
            ato: z.string().max(40).nullable().optional(),
            data_ato: z.string().max(10).nullable().optional(),
            selo: z.string().max(60).nullable().optional(),
            adquirente: z.string().max(160).nullable().optional(),
            conjuge_adq: z.string().max(160).nullable().optional(),
            transmitente: z.string().max(160).nullable().optional(),
            conjuge_transm: z.string().max(160).nullable().optional(),
            usufrutuario: z.string().max(160).nullable().optional(),
            conjuge_usu: z.string().max(160).nullable().optional(),
            outorgante: z.string().max(160).nullable().optional(),
            conjuge_outorgante: z.string().max(160).nullable().optional(),
            outorgado: z.string().max(160).nullable().optional(),
            conjuge_outorgado: z.string().max(160).nullable().optional(),
            credor: z.string().max(160).nullable().optional(),
            devedor: z.string().max(160).nullable().optional(),
            serviente: z.string().max(160).nullable().optional(),
            dominante: z.string().max(160).nullable().optional(),
            estado_civil: z
              .enum(["solteiro", "casado", "separado", "divorciado", "viúvo"])
              .nullable()
              .optional(),
            data_casamento: z.string().max(10).nullable().optional(),
            lei_casamento: z
              .enum(["antes da Lei 6.515/77", "depois da Lei 6.515/77"])
              .nullable()
              .optional(),
            reg_bens: z
              .enum([
                "comunhão universal",
                "comunhão parcial",
                "separação absoluta",
                "separação obrigatória",
                "participação final nos aquestos",
                "regime misto",
              ])
              .nullable()
              .optional(),
            pacto: z.string().max(400).nullable().optional(),
            email: z.string().max(160).nullable().optional(),
            telefone: z.string().max(30).nullable().optional(),
            identificacao: z.string().max(20).nullable().optional(),
            inscricao_estadual: z.string().max(40).nullable().optional(),
            situacao_titulares: z.enum(["ATIVO", "INATIVO"]).nullable().optional(),
            review_status: z.enum(["pendente", "revisado"]).optional(),

          })
          .strict(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const campos = Object.fromEntries(
      Object.entries(data.campos).filter(([, v]) => v !== undefined),
    ) as unknown as Database["public"]["Tables"]["index_records"]["Update"];
    const { data: anterior, error: erroAnterior } = await context.supabase
      .from("index_records")
      .select("corrections")
      .eq("id", data.id)
      .maybeSingle();
    if (erroAnterior) throw new Error(erroAnterior.message);
    const correcoesAnteriores = anterior?.corrections && typeof anterior.corrections === "object" && !Array.isArray(anterior.corrections)
      ? anterior.corrections as Record<string, unknown>
      : {};
    const agora = new Date().toISOString();
    const corrections = { ...correcoesAnteriores };
    for (const [campo, valor] of Object.entries(campos)) {
      if (campo === "review_status") continue;
      corrections[campo] = { valor_confirmado: valor, responsavel: context.userId, data_correcao: agora };
    }
    const { error } = await context.supabase
      .from("index_records")
      .update({ ...campos, corrections: JSON.parse(JSON.stringify(corrections)) })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const excluirRegistro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("index_records").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
