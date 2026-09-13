import { AlertTriangle, FileCheck2, Quote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

type Evidencia = { ato?: string | null; trecho?: string; confianca?: "alta" | "media" | "baixa" };
type Pagina = { nome?: string; folha?: string | null; qualidade?: number; alertas?: string[] };

const rotulos: Record<string, string> = {
  livro: "Matrícula / Livro",
  ultima_ficha: "Última ficha",
  ultimo_ato: "Último ato",
  area_hectare: "Área em hectares",
  cib: "CIB / NIRF",
  car: "CAR",
};

export function ConferenciaOrigem({
  paginas,
  evidencias,
}: {
  paginas: unknown;
  evidencias: unknown;
}) {
  const lista = Array.isArray(paginas) ? (paginas as Pagina[]) : [];
  const mapa = evidencias && typeof evidencias === "object" && !Array.isArray(evidencias)
    ? (evidencias as Record<string, Evidencia>)
    : {};
  if (!lista.length && !Object.keys(mapa).length) return null;

  return (
    <Accordion type="single" collapsible className="border-y border-border/70">
      <AccordionItem value="origem" className="border-0">
        <AccordionTrigger className="py-3 no-underline hover:no-underline">
          <span className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" />
            Conferir origem dos dados
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lista.map((pagina, indice) => (
              <div key={`${pagina.nome}-${indice}`} className="border border-border bg-muted/20 p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium break-all">{pagina.nome ?? `Folha ${indice + 1}`}</span>
                  <Badge variant={(pagina.qualidade ?? 0) >= 75 ? "secondary" : "destructive"}>
                    {pagina.qualidade ?? 0}%
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground">Folha {pagina.folha ?? "não identificada"}</p>
                {(pagina.alertas ?? []).map((alerta) => (
                  <p key={alerta} className="mt-1 flex gap-1 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {alerta}
                  </p>
                ))}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {Object.entries(mapa).map(([campo, evidencia]) => (
              <div key={campo} className="border-l-2 border-primary/60 pl-3">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  {rotulos[campo] ?? campo}
                  {evidencia.ato ? <Badge variant="outline">{evidencia.ato}</Badge> : null}
                  <Badge variant={evidencia.confianca === "baixa" ? "destructive" : "secondary"}>
                    {evidencia.confianca === "alta" ? "confiança alta" : "conferir"}
                  </Badge>
                </div>
                <p className="mt-1 flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Quote className="mt-0.5 h-3 w-3 shrink-0" /> {evidencia.trecho}
                </p>
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}