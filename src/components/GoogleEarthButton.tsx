import { useState } from "react";
import { Globe, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import type { ParcelExport } from "@/lib/export-registral";
import { earthKml } from "@/lib/google-earth";
import { baixarGeometria } from "@/lib/export-geometria";

export function GoogleEarthButton({ parcels, comparisonId, allowed }: { parcels?: ParcelExport[]; comparisonId?: string; allowed: boolean }) {
  const [result, setResult] = useState<ReturnType<typeof earthKml> | null>(null);
  const [busy, setBusy] = useState(false);
  async function prepare() {
    if (!allowed || busy) return;
    setBusy(true);
    try {
      let rows = parcels ?? [];
      if (comparisonId) {
        const { data: c, error } = await supabase.from("comparisons").select("document_a_id,document_b_id,metrics").eq("id", comparisonId).single();
        if (error) throw error;
        const metrics = c.metrics as Record<string, unknown> | null;
        const ids = [c.document_a_id, c.document_b_id, metrics?.["document_c_id"]].filter((id): id is string => typeof id === "string");
        const { data, error: e } = await supabase.from("parcels").select("*,segments(*)").in("document_id", ids);
        if (e) throw e;
        const chosen = [metrics?.["parcel_a_id"], metrics?.["parcel_b_id"], metrics?.["parcel_c_id"]].filter((id): id is string => typeof id === "string");
        rows = (data ?? []).filter(p => !chosen.length || chosen.includes(p.id));
      }
      setResult(earthKml(rows));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível preparar o Google Earth."); }
    finally { setBusy(false); }
  }
  if (!allowed) return null;
  return <><Button variant="outline" size="sm" disabled={busy} onClick={() => void prepare()}><Globe className="size-4" />Google Earth</Button><Dialog open={!!result} onOpenChange={open => { if (!open) setResult(null); }}><DialogContent><DialogHeader><DialogTitle>Google Earth</DialogTitle><DialogDescription>O Google Earth não importa automaticamente arquivos privados. Baixe o KML e abra-o no Google Earth Pro ou importe-o no Google Earth web. Os documentos originais não serão publicados.</DialogDescription></DialogHeader><div className="flex flex-wrap gap-3"><Button onClick={() => { if (result) baixarGeometria(result.text, "Google-Earth.kml", "application/vnd.google-earth.kml+xml"); }}><Download className="size-4" />Baixar KML</Button><Button variant="outline" onClick={() => { if (result) window.open(`https://earth.google.com/web/search/${result.lat},${result.lon}`, "_blank", "noopener,noreferrer"); }}><ExternalLink className="size-4" />Abrir Google Earth</Button></div></DialogContent></Dialog></>;
}