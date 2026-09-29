import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PAPEIS = ["admin", "official", "operator", "reviewer", "read_only"] as const;

async function exigirAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Acesso restrito a administradores.");
}

export const souAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { admin: Boolean(data) };
  });

export const listarUsuarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: perfis, error: e1 }, { data: papeis, error: e2 }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, status, created_at")
        .order("created_at", { ascending: true }),
      supabaseAdmin.from("user_roles").select("user_id, role"),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const { data: analises, error: e3 } = await supabaseAdmin
      .from("analyses")
      .select("id, created_by, created_at");
    if (e3) throw new Error(e3.message);

    return (perfis ?? []).map((p) => ({
      ...p,
      roles: (papeis ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as string),
      total_analises: (analises ?? []).filter((a) => a.created_by === p.id).length,
      ultima_atividade:
        (analises ?? [])
          .filter((a) => a.created_by === p.id)
          .map((a) => a.created_at)
          .sort()
          .at(-1) ?? null,
    }));
  });

export const listarAtividade = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: analises, error: e1 }, { data: perfis, error: e2 }] = await Promise.all([
      supabaseAdmin
        .from("analyses")
        .select("id, title, status, created_by, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(300),
      supabaseAdmin.from("profiles").select("id, full_name, email"),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const ids = (analises ?? []).map((a) => a.id);
    const { data: comps } = ids.length
      ? await supabaseAdmin
          .from("comparisons")
          .select("id, analysis_id, comparison_type, status, classification")
          .in("analysis_id", ids)
      : { data: [] as any[] };

    return (analises ?? []).map((a) => {
      const autor = (perfis ?? []).find((p) => p.id === a.created_by);
      const c = (comps ?? []).filter((x) => x.analysis_id === a.id);
      return {
        ...a,
        autor_nome: autor?.full_name || "",
        autor_email: autor?.email || "—",
        comparacoes: c.length,
        incompativeis: c.filter((x) => x.classification === "incompatible").length,
      };
    });
  });

export const definirPapel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), role: z.enum(PAPEIS) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigirAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removerPapel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), role: z.enum(PAPEIS) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigirAdmin(context);
    if (data.userId === context.userId && data.role === "admin")
      throw new Error("Não é possível remover o próprio papel de administrador.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", data.role);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Manage the actual email allowlist, including people who have not signed up yet. */
export const listarAutorizados = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("authorized_emails")
      .select("email, full_name, role").order("full_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const autorizarEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
    fullName: z.string().trim().min(3).max(200),
    role: z.enum(["admin", "operator"]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await exigirAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("authorized_emails").upsert({
      email: data.email, full_name: data.fullName, role: data.role,
    });
    if (error) throw new Error(error.message);
    const { data: profile } = await supabaseAdmin.from("profiles")
      .select("id").ilike("email", data.email).maybeSingle();
    if (profile) {
      const { error: roleError } = await supabaseAdmin.from("user_roles").upsert({
        user_id: profile.id, role: data.role,
      }, { onConflict: "user_id,role" });
      if (roleError) throw new Error(roleError.message);
    }
    return { ok: true };
  });

export const revogarEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ email: z.string().trim().email() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigirAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ownProfile } = await supabaseAdmin.from("profiles")
      .select("email").eq("id", context.userId).single();
    if (ownProfile?.email.toLowerCase() === data.email.toLowerCase())
      throw new Error("Não é possível revogar o próprio acesso.");
    const { error } = await supabaseAdmin.from("authorized_emails")
      .delete().eq("email", data.email.toLowerCase());
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Exclusão de uma análise inteira (documentos, arquivos e comparações). Somente admin. */
export const excluirAnalise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ analysisId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigirAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("storage_path")
      .eq("analysis_id", data.analysisId);
    const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean) as string[];
    if (paths.length) await supabaseAdmin.storage.from("documentos").remove(paths);

    const { error } = await supabaseAdmin
      .from("analyses")
      .delete()
      .eq("id", data.analysisId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Exclusão de um documento enviado e do respectivo arquivo. Somente admin. */
export const excluirDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigirAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("storage_path")
      .eq("id", data.documentId)
      .maybeSingle();
    // Filhos guardam somente texto: excluir um deles não remove o PDF original.
    if (doc?.storage_path)
      await supabaseAdmin.storage.from("documentos").remove([doc.storage_path]);

    const { error } = await supabaseAdmin
      .from("documents")
      .delete()
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Exclusão de uma comparação (e respectivos achados). Somente admin, com registro em auditoria. */
export const excluirComparacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ comparisonId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigirAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: comp } = await supabaseAdmin
      .from("comparisons")
      .select("id, analysis_id, comparison_type, classification, summary")
      .eq("id", data.comparisonId)
      .maybeSingle();
    if (!comp) throw new Error("Comparação não encontrada.");

    const { error } = await supabaseAdmin
      .from("comparisons")
      .delete()
      .eq("id", data.comparisonId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      entity_type: "comparison",
      entity_id: comp.id,
      action: "delete",
      metadata: {
        analysis_id: comp.analysis_id,
        tipo: comp.comparison_type,
        classificacao: comp.classification,
        resumo: comp.summary,
      },
    });

    return { ok: true, analysisId: comp.analysis_id };
  });

/** Exclusão de comparação do CheckTítulo — restrita a administradores. */
export const excluirComparacaoQualificacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigirAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: comps } = await supabaseAdmin
      .from("qualification_comparisons")
      .select("id, set_id, title, classification, summary")
      .in("id", data.ids);
    if (!comps?.length) throw new Error("Comparação não encontrada.");

    const { error } = await supabaseAdmin
      .from("qualification_comparisons")
      .delete()
      .in("id", data.ids);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert(
      comps.map((c) => ({
        actor_id: context.userId,
        entity_type: "qualification_comparison",
        entity_id: c.id,
        action: "delete",
        metadata: {
          set_id: c.set_id,
          titulo: c.title,
          classificacao: c.classification,
          resumo: c.summary,
        },
      })),
    );

    return { ok: true as const, setId: comps[0]!.set_id };
  });
