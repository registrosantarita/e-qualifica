import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { LogOut, Plus, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { souAdmin, excluirAnalise } from "@/lib/admin.functions";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { STATUS_ANALISE, STATUS_ANALISE_CLASS } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({
    meta: [
      { title: "Painel de análises — GeoConfronto · e-Qualifica" },
      {
        name: "description",
        content:
          "Acompanhe suas análises de conferência registral, documentos e comparações técnicas.",
      },
      { property: "og:title", content: "Painel de análises — GeoConfronto · e-Qualifica" },
      {
        property: "og:description",
        content: "Gestão de casos de conferência registral e geométrica.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Painel,
});

const novaAnalise = z.object({
  title: z.string().trim().min(3, "Informe um título com ao menos 3 caracteres.").max(255),
  objective: z.string().trim().max(2000),
  tags: z.string().max(300),
});

function Painel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [tags, setTags] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const souAdminFn = useServerFn(souAdmin);
  const admin = useQuery({
    queryKey: ["sou-admin"],
    queryFn: () => souAdminFn({}),
    staleTime: 5 * 60 * 1000,
  });

  const excluirFn = useServerFn(excluirAnalise);
  const excluir = useMutation({
    mutationFn: (analysisId: string) => excluirFn({ data: { analysisId } }),
    onSuccess: () => {
      setSelectedIds((ids) => ids.filter((id) => !excluir.variables || id !== excluir.variables));
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
      toast.success("Análise excluída.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluirSelecionadas = useMutation({
    mutationFn: async (ids: string[]) => {
      const deleted: string[] = [];
      const failed: string[] = [];
      // Usa a mesma operação protegida já utilizada na exclusão individual.
      for (const analysisId of ids) {
        try {
          await excluirFn({ data: { analysisId } });
          deleted.push(analysisId);
        } catch {
          failed.push(analysisId);
        }
      }
      return { deleted, failed };
    },
    onSuccess: ({ deleted, failed }) => {
      setSelectedIds(failed);
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
      if (deleted.length) toast.success(`${deleted.length} análise(s) excluída(s).`);
      if (failed.length) toast.error(`${failed.length} análise(s) não puderam ser excluídas. Tente novamente.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });



  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const { data: analyses, isLoading } = useQuery({
    queryKey: ["analyses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analyses")
        .select("id, title, objective, status, tags, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const availableIds = (analyses ?? []).map((a) => a.id);
  const selectedAvailableIds = selectedIds.filter((id) => availableIds.includes(id));
  const allSelected = availableIds.length > 0 && selectedAvailableIds.length === availableIds.length;
  const deleting = excluir.isPending || excluirSelecionadas.isPending;

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id));
  }

  function confirmBulkDelete() {
    if (!admin.data?.admin || selectedAvailableIds.length === 0 || deleting) return;
    if (confirm(`Excluir definitivamente ${selectedAvailableIds.length} análise(s) selecionada(s), incluindo seus documentos e comparações?`)) {
      excluirSelecionadas.mutate(selectedAvailableIds);
    }
  }

  const create = useMutation({
    mutationFn: async () => {
      const parsed = novaAnalise.safeParse({ title, objective, tags });
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessão expirada.");
      const { data, error } = await supabase
        .from("analyses")
        .insert({
          title: parsed.data.title,
          objective: parsed.data.objective,
          created_by: uid,
          responsible_user_id: uid,
          tags: parsed.data.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 12),
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      setOpen(false);
      setTitle("");
      setObjective("");
      setTags("");
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
      navigate({ to: "/analises/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Casos de conferência</p>
          <h1 className="mt-2 text-4xl">GeoConfronto — Minhas análises</h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            O envio de arquivos e a colagem de texto livre acontecem dentro de
            uma análise. Crie ou abra um caso para enviar memoriais, plantas,
            escrituras e KML/GeoJSON.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="lg">
                <Plus className="mr-2 h-4 w-4" />
                Nova análise
              </Button>
            </DialogTrigger>

            <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">Abrir nova análise</DialogTitle>
              <DialogDescription>
                Cada análise reúne documentos, extrações, comparações e achados
                com trilha de auditoria.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="titulo">Título do caso</Label>
                <Input
                  id="titulo"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Desdobro — Matrícula 12.345"
                  maxLength={255}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="objetivo">Objetivo da conferência</Label>
                <Textarea
                  id="objetivo"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="Ex.: Verificar equivalência entre o memorial apresentado e o descritivo da matrícula."
                  rows={3}
                  maxLength={2000}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Etiquetas (separadas por vírgula)</Label>
                <Input
                  id="tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="desdobro, confrontante, memorial"
                  maxLength={300}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => create.mutate()}
                disabled={create.isPending}
              >
                {create.isPending ? "Criando..." : "Criar análise"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button variant="outline" size="lg" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sair
        </Button>
      </div>
      </div>

      <div className="rule-gold mt-8 w-24" />

      {isLoading ? (
        <p className="mt-10 text-sm text-muted-foreground">Carregando análises...</p>
      ) : !analyses || analyses.length === 0 ? (
        <div className="panel mt-10 p-10 text-center">
          <h2 className="text-2xl">Nenhuma análise ainda</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Abra uma análise para enviar memoriais, extrair dados técnicos e
            comparar documentos com tolerâncias configuráveis.
          </p>
          <Button className="mt-6" size="lg" onClick={() => setOpen(true)}>
            Começar: criar análise e enviar arquivos
          </Button>
        </div>

      ) : (
        <div className="mt-10">
        {admin.data?.admin && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                aria-label="Selecionar tudo ou limpar seleção"
                checked={allSelected}
                disabled={deleting}
                onCheckedChange={(checked) => setSelectedIds(checked === true ? availableIds : [])}
              />
              <span>{allSelected ? "Limpar seleção" : "Selecionar tudo"}</span>
            </label>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selectedAvailableIds.length === 0 || deleting}
              onClick={confirmBulkDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {excluirSelecionadas.isPending ? "Excluindo..." : `Excluir selecionadas (${selectedAvailableIds.length})`}
            </Button>
          </div>
        )}
        <ul className="grid gap-4 md:grid-cols-2">
          {analyses.map((a) => (
            <li key={a.id} className="panel flex transition-colors hover:border-accent">
              {admin.data?.admin && (
                <div className="py-6 pl-4">
                  <Checkbox
                    aria-label={`Selecionar análise ${a.title}`}
                    checked={selectedAvailableIds.includes(a.id)}
                    disabled={deleting}
                    onCheckedChange={(checked) => toggleSelected(a.id, checked === true)}
                  />
                </div>
              )}
              <Link
                to="/analises/$id"
                params={{ id: a.id }}
                className="block flex-1 min-w-0 p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-xl leading-snug">{a.title}</h2>
                </div>
                {a.objective && (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {a.objective}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {(a.tags ?? []).map((t) => (
                    <span
                      key={t}
                      className="rounded-sm border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                  <span className="numeric ml-auto text-[11px] text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </Link>
              <div className="flex flex-col items-end justify-between p-6 pl-2">
                <Badge
                  variant="secondary"
                  className={`shrink-0 ${STATUS_ANALISE_CLASS[a.status]}`}
                >
                  {STATUS_ANALISE[a.status]}
                </Badge>
                {admin.data?.admin && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={deleting}
                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (
                        confirm(
                          `Excluir definitivamente a análise "${a.title}", seus documentos e comparações?`,
                        )
                      )
                        excluir.mutate(a.id);
                    }}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Excluir
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        </div>

      )}
    </main>
  );
}
