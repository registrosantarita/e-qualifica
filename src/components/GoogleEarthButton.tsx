import { useState } from "react";
import { Globe, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import type { ParcelExport } from "@/lib/export-registral";
import { earthKml } from "@/lib/google-earth";
import { baixarGeometria } from "@/lib/export-geometria";
import { confirmedEarthUtm, needsEarthUtm, type EarthUtmReference } from "@/lib/earth-utm";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { montarGeoJson } from "@/lib/export-geojson";

export function GoogleEarthButton({ parcels, comparisonId, allowed, format = "earth" }: { parcels?: ParcelExport[]; comparisonId?: string; allowed: boolean; format?: "earth" | "json" }) {
  const [result, setResult] = useState<ReturnType<typeof earthKml> | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ParcelExport[] | null>(null);
  const [references, setReferences] = useState<Record<number, Partial<Omit<EarthUtmReference, "zone">> & { zone?: number | undefined }>>({});
  function generate(rows: ParcelExport[], refs: (EarthUtmReference | undefined)[] = []) {
    if (!allowed) return;
    if (format === "json") baixarGeometria(montarGeoJson(rows, refs), `perimetro-${(rows[0]?.label ?? "descricao").replace(/[^\p{L}\p{N}._-]+/gu, "-")}.json`, "application/geo+json");
    else setResult(earthKml(rows, refs));
  }
  function confirmUtm() {
    if (!pending || !allowed) return;
    try {
      const confirmed = pending.map((p, index) => {
        if (!needsEarthUtm(p)) return undefined;
        const r = references[index];
        if (!confirmedEarthUtm(r)) throw new Error(`Confirme fuso, hemisfério e datum de ${p.label ?? `Documento ${index + 1}`}.`);
        return { zone: r.zone, hemisphere: r.hemisphere, datum: r.datum };
      });
      generate(pending, confirmed);
      setPending(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível converter as coordenadas UTM."); }
  }
  async function prepare() {
    if (!allowed || busy) return;
    setBusy(true);
    setResult(null);
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
      if (rows.some(needsEarthUtm)) {
        setReferences({});
        setPending(rows);
      } else generate(rows);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível preparar o Google Earth."); }
    finally { setBusy(false); }
  }
  if (!allowed) return null;
  return <>
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void prepare()}>{format === "json" ? <Download className="size-4" /> : <Globe className="size-4" />}{format === "json" ? "Exportar JSON (GeoJSON)" : "Google Earth"}</Button>
    <Dialog open={!!pending} onOpenChange={open => { if (!open) setPending(null); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Referência das coordenadas UTM</DialogTitle><DialogDescription>Confirme os dados de referência no memorial ou na planta. Não se deve escolher o fuso ou o datum por suposição. As coordenadas originais serão preservadas.</DialogDescription></DialogHeader>
        {pending?.map((p, index) => needsEarthUtm(p) && <fieldset key={index} className="space-y-3 border-t border-border pt-3">
          <legend className="max-w-full break-words font-medium">{p.label ?? `Documento ${index + 1}`}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label htmlFor={`earth-zone-${index}`}>Fuso UTM</Label><Input id={`earth-zone-${index}`} type="number" min={1} max={60} step={1} value={references[index]?.zone ?? ""} onChange={e => setReferences(prev => ({...prev, [index]: {...prev[index], zone: e.target.value ? Number(e.target.value) : undefined}}))} /></div>
            <div className="space-y-1"><Label htmlFor={`earth-hemisphere-${index}`}>Hemisfério</Label><Select value={references[index]?.hemisphere ?? ""} onValueChange={v => setReferences(prev => ({...prev, [index]: {...prev[index], hemisphere: v === "S" ? "S" : "N"}}))}><SelectTrigger id={`earth-hemisphere-${index}`}><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent><SelectItem value="S">Sul</SelectItem><SelectItem value="N">Norte</SelectItem></SelectContent></Select></div>
            <div className="space-y-1"><Label htmlFor={`earth-datum-${index}`}>Datum</Label><Select value={references[index]?.datum ?? ""} onValueChange={v => setReferences(prev => ({...prev, [index]: {...prev[index], datum: v === "SIRGAS2000" ? "SIRGAS2000" : "WGS84"}}))}><SelectTrigger id={`earth-datum-${index}`}><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent><SelectItem value="SIRGAS2000">SIRGAS 2000</SelectItem><SelectItem value="WGS84">WGS 84</SelectItem></SelectContent></Select></div>
          </div>
        </fieldset>)}
        <Button disabled={!pending?.every((p, index) => !needsEarthUtm(p) || confirmedEarthUtm(references[index]))} onClick={confirmUtm}><Globe className="size-4" />{format === "json" ? "Gerar JSON" : "Converter para Google Earth"}</Button>
      </DialogContent>
    </Dialog>
    <Dialog open={!!result} onOpenChange={open => { if (!open) setResult(null); }}><DialogContent><DialogHeader><DialogTitle>Google Earth</DialogTitle><DialogDescription>O Google Earth não importa automaticamente arquivos privados. Baixe o KML e abra-o no Google Earth Pro ou importe-o no Google Earth web. Os documentos originais não serão publicados.</DialogDescription></DialogHeader><div className="flex flex-wrap gap-3"><Button onClick={() => { if (result) baixarGeometria(result.text, "Google-Earth.kml", "application/vnd.google-earth.kml+xml"); }}><Download className="size-4" />Baixar KML</Button><Button variant="outline" onClick={() => { if (result) window.open(`https://earth.google.com/web/search/${result.lat},${result.lon}`, "_blank", "noopener,noreferrer"); }}><ExternalLink className="size-4" />Abrir Google Earth</Button></div></DialogContent></Dialog>
  </>;
}