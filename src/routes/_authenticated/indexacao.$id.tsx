import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileUp, ScanText, Trash2 } from "lucide-react";
import {
  atualizarRegistro,
  excluirRegistro,
  indexarGruposMatricula,
  indexarMatricula,
  obterLote,
  prepararArquivosIndexacao,
} from "@/lib/checkindex.functions";
import { exportarCsv, exportarJson, exportarXlsx, type RegistroIndexado } from "@/lib/export-index";
import type { IndexAto } from "@/lib/matricula-index-parser";
import { TabelaOnus } from "@/components/TabelaOnus";
import { ConferenciaOrigem } from "@/components/checkindex/ConferenciaOrigem";

type GrupoPreparado = Awaited<ReturnType<typeof prepararArquivosIndexacao>>[number];
type RegistroComOrigem = RegistroIndexado & { source_pages?: unknown; field_evidence?: unknown };

export const Route = createFileRoute("/_authenticated/indexacao/$id")({
  head: () => ({
    meta: [
      { title: "CheckIndex — Lote de indexação — e-Qualifica" },
      {
        name: "description",
        content:
          "Revise os dados extraídos das matrículas digitalizadas e exporte o arquivo para o sistema do Cartório.",
      },
      { property: "og:title", content: "CheckIndex — Lote de indexação — e-Qualifica" },
      {
        property: "og:description",
        content: "Revisão e exportação dos dados indexados das matrículas.",
      },
    ],
  }),
  component: LoteDetalhe,
});

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const NATUREZA_LABEL: Record<string, string> = {
  urbano: "Urbano",
  rural: "Rural",
  nao_identificado: "Não identificado",
};

function LoteDetalhe() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const obter = useServerFn(obterLote);
  const indexar = useServerFn(indexarMatricula);
  const preparar = useServerFn(prepararArquivosIndexacao);
  const salvarGrupos = useServerFn(indexarGruposMatricula);
  const atualizar = useServerFn(atualizarRegistro);
  const excluir = useServerFn(excluirRegistro);
  const fileRef = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState("");
  const [rotulo, setRotulo] = useState("");
  const [gruposPreparados, setGruposPreparados] = useState<GrupoPreparado[]>([]);
  const [refazerOcr, setRefazerOcr] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["checkindex-lote", id],
    queryFn: () => obter({ data: { id } }),
  });

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["checkindex-lote", id] });

  const enviarArquivos = useMutation({
    mutationFn: async (files: FileList) => {
      const arquivos = await Promise.all(Array.from(files).map(async (file) => ({
        fileName: file.name,
        extension: file.name.split(".").pop() ?? "",
        base64: await fileToBase64(file),
      })));
      return preparar({ data: { arquivos, refazerOcr } });
    },
    onSuccess: (grupos) => {
      setGruposPreparados(grupos);
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmarGrupos = useMutation({
    mutationFn: () => salvarGrupos({ data: { batchId: id, grupos: gruposPreparados } }),
    onSuccess: async () => {
      setGruposPreparados([]);
      await invalidar();
      toast.success("Folhas agrupadas e matrícula(s) indexada(s).");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enviarTexto = useMutation({
    mutationFn: async () => {
      if (texto.trim().length < 40) throw new Error("Cole o texto completo da matrícula.");
      return indexar({ data: { batchId: id, label: rotulo.trim(), texto } });
    },
    onSuccess: async () => {
      setTexto("");
      setRotulo("");
      await invalidar();
      toast.success("Matrícula indexada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revisar = useMutation({
    mutationFn: (registroId: string) =>
      atualizar({ data: { id: registroId, campos: { review_status: "revisado" } } }),
    onSuccess: async () => {
      await invalidar();
      toast.success("Registro marcado como revisado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: (registroId: string) => excluir({ data: { id: registroId } }),
    onSuccess: async () => {
      await invalidar();
      toast.success("Registro excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const registros = (data?.registros ?? []) as unknown as RegistroComOrigem[];
  const baseNome = (data?.lote.title ?? "checkindex").replace(/[^\w\-]+/g, "_").toLowerCase();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link
        to="/indexacao"
        className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Voltar aos lotes
      </Link>

      <header className="mt-4">
        <p className="eyebrow">CheckIndex</p>
        <h1 className="font-display text-2xl text-foreground">
          {isLoading ? "Carregando…" : data?.lote.title}
        </h1>
        {data?.lote.note && (
          <p className="mt-1 text-sm text-muted-foreground">{data.lote.note}</p>
        )}
      </header>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-display text-lg text-foreground">Enviar matrículas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Selecione todas as folhas da matrícula de uma vez. Elas serão identificadas, ordenadas e
            conferidas antes da gravação.
          </p>
          <label className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
            <Checkbox checked={refazerOcr} onCheckedChange={(valor) => setRefazerOcr(valor === true)} />
            <span>
              Refazer a leitura com IA
              <span className="block text-xs">Use somente quando o texto já existente estiver ruim. Consome créditos.</span>
            </span>
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Input
              ref={fileRef}
              type="file"
              multiple
              className="max-w-xs"
              onChange={(e) => {
                if (e.target.files?.length) enviarArquivos.mutate(e.target.files);
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={enviarArquivos.isPending}
            >
              <FileUp className="mr-2 h-4 w-4" />
              {enviarArquivos.isPending ? "Lendo e agrupando…" : "Procurar…"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-display text-lg text-foreground">Colar texto da matrícula</h2>
          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="rotulo">Rótulo</Label>
              <Input
                id="rotulo"
                value={rotulo}
                onChange={(e) => setRotulo(e.target.value)}
                placeholder="Matrícula 12.345"
              />
            </div>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={5}
              placeholder="Cole aqui o inteiro teor da matrícula…"
            />
            <Button onClick={() => enviarTexto.mutate()} disabled={enviarTexto.isPending}>
              {enviarTexto.isPending ? "Indexando…" : "Indexar texto"}
            </Button>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg text-foreground">
            Registros indexados ({registros.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!registros.length}
              onClick={() => exportarCsv(registros, `${baseNome}.csv`)}
            >
              <Download className="mr-2 h-4 w-4" /> CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!registros.length}
              onClick={() => void exportarXlsx(registros, `${baseNome}.xlsx`)}
            >
              <Download className="mr-2 h-4 w-4" /> XLSX
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!registros.length}
              onClick={() => exportarJson(registros, `${baseNome}.json`)}
            >
              <Download className="mr-2 h-4 w-4" /> JSON
            </Button>
          </div>
        </div>

        {!registros.length && (
          <p className="mt-6 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma matrícula indexada neste lote.
          </p>
        )}

        <div className="mt-6 space-y-4">
          {registros.map((r) => {
            const cad = (r.cadastros ?? {}) as Record<string, string | null>;
            const props = Array.isArray(r.proprietarios) ? r.proprietarios : [];
            const todosOnus = (Array.isArray(r.onus) ? r.onus : []) as unknown as IndexAto[];
            const onus = todosOnus.filter((o) => o.vigente !== false);
            const onusCancelados = todosOnus.filter((o) => o.vigente === false);
            const atos = Array.isArray(r.atos) ? r.atos : [];
            return (
              <article key={r.id} className="rounded-lg border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-base text-foreground">
                      {r.matricula_numero ? `Matrícula ${r.matricula_numero}` : r.label}
                    </h3>
                    <p className="text-xs text-muted-foreground">{r.label}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={r.review_status === "revisado" ? "default" : "secondary"}>
                      {r.review_status === "revisado" ? "Revisado" : "Pendente de revisão"}
                    </Badge>
                    {r.review_status !== "revisado" && (
                      <Button size="sm" variant="ghost" onClick={() => revisar.mutate(r.id)}>
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Revisar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => remover.mutate(r.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Excluir
                    </Button>
                  </div>
                </div>

                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
                  {[
                    ["Tipo de livro", r.tipo_livro === 3 ? "3 — Registro Auxiliar" : "2 — Matrícula"],
                    ["Livro", r.livro ?? r.matricula_numero],
                    ["CNS", r.cns],
                    ["Abertura", r.data_abertura],
                    ["Última ficha", r.ultima_ficha],
                    ["Último ato", r.ultimo_ato],
                    ["Registro anterior", r.registro_anterior],
                    [
                      "Encerrada",
                      r.encerrada
                        ? `ENCERRADA:${(r.matriculas_abertas ?? []).join(";")}`
                        : null,
                    ],
                    ["Natureza", NATUREZA_LABEL[r.natureza] ?? r.natureza],
                    ["CEP", r.cep],
                    ["Tipo de logradouro", r.tipo_logradouro],
                    ["Logradouro", r.logradouro],
                    ["Número", r.numero_logradouro],
                    ["Bairro", r.bairro],
                    ["Lote", r.lote],
                    ["Quadra", r.quadra],
                    ["Condomínio", r.condominio],
                    ["Unidade", r.unidade],
                    ["Andar", r.andar],
                    ["Bloco", r.bloco],
                    ["Tipo rural", r.tipo_rural],
                    ["Denominação rural", r.denominacao_rural],
                    ["CIB", cad['cib']],
                    ["CIM", r.cim ?? cad['cim']],
                    ["CCIR", cad['ccir']],
                    ["CAR", cad['car']],
                    ["Certificação (INCRA)", r.certificacao],
                    ["Área (m²)", r.area_m2],
                    ["Área (ha)", r.area_hectare],
                    ["Perímetro (m)", r.perimetro_m],
                    ["Área construída (m²)", r.area_construida_m2],
                    ["Prenotação", r.prenotacao],
                    ["Tipo de ato", r.tipo_ato],
                    ["Ato", r.ato],
                    ["Data do ato", r.data_ato],
                    ["Selo", r.selo],
                    ["Adquirente", r.adquirente],
                    ["Cônjuge do adquirente", r.conjuge_adq],
                    ["Transmitente", r.transmitente],
                    ["Cônjuge do transmitente", r.conjuge_transm],
                    ["Usufrutuário", r.usufrutuario],
                    ["Cônjuge do usufrutuário", r.conjuge_usu],
                    ["Outorgante", r.outorgante],
                    ["Cônjuge do outorgante", r.conjuge_outorgante],
                    ["Outorgado", r.outorgado],
                    ["Cônjuge do outorgado", r.conjuge_outorgado],
                    ["Credor", r.credor],
                    ["Devedor", r.devedor],
                    ["Serviente", r.serviente],
                    ["Dominante", r.dominante],
                    ["Estado civil", r.estado_civil],
                    ["Data do casamento", r.data_casamento],
                    ["Lei do casamento", r.lei_casamento],
                    ["Regime de bens", r.reg_bens],
                    ["Pacto antenupcial", r.pacto],
                    ["E-mail", r.email],
                    ["Telefone", r.telefone],
                    ["Identificação (CPF/CNPJ)", r.identificacao],
                    ["Inscrição estadual", r.inscricao_estadual],
                    ["Situação do titular", r.situacao_titulares],
                  ].map(([rotulo, valor]) => (

                    <div key={String(rotulo)}>
                      <dt className="eyebrow">{rotulo}</dt>
                      <dd className="text-foreground">
                        {valor === null || valor === undefined || valor === "" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          String(valor)
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>

                {r.endereco && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    <span className="eyebrow mr-2">Endereço do titular</span>
                    {r.endereco}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded border border-border px-2 py-1 text-muted-foreground">
                    {props.length} proprietário(s)
                  </span>
                  <span className="rounded border border-border px-2 py-1 text-muted-foreground">
                    {atos.length} ato(s)
                  </span>
                  <span className="rounded border border-border px-2 py-1 text-muted-foreground">
                    {onus.length} ônus vigente(s)
                  </span>
                  {onusCancelados.length > 0 && (
                    <span className="rounded border border-border px-2 py-1 text-muted-foreground line-through">
                      {onusCancelados.length} cancelado(s)
                    </span>
                  )}
                </div>

                <TabelaOnus itens={todosOnus} origem={r.label} />

                <div className="mt-4">
                  <ConferenciaOrigem paginas={r.source_pages} evidencias={r.field_evidence} />
                </div>


                {props.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {(props as { nome?: string | null; cpf_cnpj?: string | null; situacao?: string }[]).map(
                      (p, i) => {
                        const inativo = p.situacao === "INATIVO";
                        return (
                          <li
                            key={`${p.cpf_cnpj ?? p.nome ?? i}`}
                            className={inativo ? "text-destructive line-through" : "text-foreground"}
                          >
                            {p.nome ?? "—"}
                            {p.cpf_cnpj ? ` (${p.cpf_cnpj})` : ""}
                            <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">
                              {inativo ? "inativo" : "ativo"}
                            </span>
                          </li>
                        );
                      },
                    )}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <p className="mt-10 text-xs text-muted-foreground">
        Os dados extraídos são um apoio à indexação e devem ser conferidos antes da importação no
        sistema do Cartório.
      </p>

      <Dialog open={gruposPreparados.length > 0} onOpenChange={(aberto) => !aberto && setGruposPreparados([])}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Confirmar composição das matrículas</DialogTitle>
            <DialogDescription>
              Confira a matrícula e a ordem das folhas. Nada será salvo antes da confirmação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {gruposPreparados.map((grupo, grupoIndice) => (
              <section key={`${grupo.matricula}-${grupoIndice}`} className="border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-base">
                    {grupo.matricula ? `Matrícula ${grupo.matricula}` : "Matrícula não identificada"}
                  </h3>
                  <Badge variant="outline">{grupo.paginas.length} folha(s)</Badge>
                </div>
                <ol className="mt-3 space-y-2">
                  {grupo.paginas.map((pagina, paginaIndice) => (
                    <li key={`${pagina.nome}-${paginaIndice}`} className="flex items-start justify-between gap-3 border-t border-border/60 pt-2 text-sm">
                      <div>
                        <span className="font-medium">{paginaIndice + 1}. {pagina.nome}</span>
                        <span className="ml-2 text-muted-foreground">Folha {pagina.folha ?? "não identificada"}</span>
                        {pagina.alertas.map((alerta) => (
                          <p key={alerta} className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" /> {alerta}
                          </p>
                        ))}
                      </div>
                      <Badge variant={pagina.qualidade >= 75 ? "secondary" : "destructive"}>
                        <ScanText className="mr-1 h-3 w-3" /> {pagina.qualidade}%
                      </Badge>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGruposPreparados([])}>Cancelar</Button>
            <Button onClick={() => confirmarGrupos.mutate()} disabled={confirmarGrupos.isPending}>
              {confirmarGrupos.isPending ? "Salvando…" : "Confirmar e indexar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
