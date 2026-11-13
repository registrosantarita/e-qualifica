import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { createReportDownload } from "@/lib/batch-export";
import { loadComparisonReport } from "@/lib/comparison-report";
import { baixarGeometria } from "@/lib/export-geometria";

export function ReportBatchDialog({ ids, allowed }: { ids: string[]; allowed: boolean }) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState("");
  async function generate(mode: "individual" | "combined") {
    if (!allowed || !ids.length || progress) return;
    try {
      const inputs = [];
      for (const [i, id] of ids.entries()) { setProgress(`Gerando ${i + 1}/${ids.length}…`); inputs.push({ id, input: await loadComparisonReport(id) }); }
      const download = await createReportDownload(inputs, mode);
      baixarGeometria(download.bytes, download.name, download.mime);
      toast.success(`${ids.length} relatório(s) gerado(s).`); setOpen(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha na geração dos relatórios."); }
    finally { setProgress(""); }
  }
  return <><Button size="sm" disabled={!allowed || !ids.length} onClick={() => setOpen(true)}>Gerar relatórios selecionados</Button><Dialog open={open} onOpenChange={value => { if (!progress) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Como deseja gerar os relatórios?</DialogTitle><DialogDescription>{ids.length} comparação(ões) selecionada(s).</DialogDescription></DialogHeader><div className="flex flex-wrap gap-3"><Button disabled={!!progress} onClick={() => void generate("individual")}>Um PDF por comparação (ZIP)</Button><Button variant="outline" disabled={!!progress} onClick={() => void generate("combined")}>Um único PDF com todas</Button></div>{progress && <p role="status" className="text-sm">{progress}</p>}</DialogContent></Dialog></>;
}