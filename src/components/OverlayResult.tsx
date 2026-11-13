import type { OverlayMetrics } from "@/lib/overlay-engine";
import { fmtNum, coordToDms } from "@/lib/labels";

export function OverlayResult({ overlay: o }: { overlay: OverlayMetrics }) {
  const vertices = o.polygons.flat();
  const minX = Math.min(...vertices.map(v => v.x)), maxX = Math.max(...vertices.map(v => v.x));
  const minY = Math.min(...vertices.map(v => v.y)), maxY = Math.max(...vertices.map(v => v.y));
  const scale = Math.min(700 / Math.max(maxX - minX, 1), 420 / Math.max(maxY - minY, 1));
  const x = (n: number) => 50 + (n - minX) * scale;
  const y = (n: number) => 470 - (n - minY) * scale;
  return <section className="mt-8 space-y-5">
    <h2 className="text-2xl">Conferência de sobreposição</h2>
    <p className="text-sm text-muted-foreground">{o.reference}</p>
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {[["Área total", o.totalAreaM2], ["Gleba 1", o.parcelAreasM2[0]], ["Gleba 2", o.parcelAreasM2[1]], ["Área não coberta", o.gapM2], ["Sobreposição entre glebas", o.overlapM2], ["Área excedente", o.outsideM2]].map(([label, n]) => <div key={String(label)}><dt className="eyebrow">{label}</dt><dd className="numeric text-lg">{fmtNum(typeof n === "number" ? n : null, 6)} m²</dd></div>)}
    </dl>
    <p className="numeric text-sm">Afastamento do contorno externo: {fmtNum(o.boundaryDeviationM, 6)} m</p>
    <svg viewBox="0 0 800 520" role="img" aria-label="Sobreposição da área total com as duas glebas" className="w-full max-h-[520px] border border-border bg-card">
      {o.polygons.slice(1).map((p, i) => <polygon key={i} points={p.map(v => `${x(v.x)},${y(v.y)}`).join(" ")} className={i === 0 ? "fill-primary/20 stroke-primary" : "fill-success/20 stroke-success"} strokeWidth="2" />)}
      <polygon points={(o.polygons[0] ?? []).map(v => `${x(v.x)},${y(v.y)}`).join(" ")} className="fill-none stroke-foreground" strokeWidth="3" strokeDasharray="7 4" />
      {o.polygons.slice(1).flat().filter(v => v.newVertex).map((v, i) => <g key={i}><circle cx={x(v.x)} cy={y(v.y)} r="6" className="fill-accent stroke-accent-foreground" /><title>{v.name} — novo vértice {v.external ? "externo" : "interno"}</title></g>)}
    </svg>
    <div className="flex flex-wrap gap-5 text-sm"><span className="text-foreground">Área total — tracejado</span><span className="text-primary">Gleba 1</span><span className="text-success">Gleba 2</span><mark className="bg-accent/40 text-accent-foreground px-1">Novos vértices</mark></div>
    {o.polygons.map((p, i) => <div key={i} className="space-y-2"><h3 className="text-lg">{i === 0 ? "Área total" : `Gleba ${i}`} — {o.labels[i]}</h3><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left"><th className="p-2">Vértice</th><th className="p-2">Latitude / N</th><th className="p-2">Longitude / E</th><th className="p-2">Situação</th></tr></thead><tbody>{p.map((v, j) => <tr key={j} className={v.newVertex ? "border-b border-border bg-accent/30" : !v.matched && i === 0 ? "border-b border-border bg-destructive/10" : "border-b border-border"}><td className="p-2">{v.name}</td><td className="numeric p-2 whitespace-nowrap">{v.lat !== null ? coordToDms(v.lat, "lat", v.lat_raw) : fmtNum(v.north, 6)}</td><td className="numeric p-2 whitespace-nowrap">{v.lon !== null ? coordToDms(v.lon, "lon", v.lon_raw) : fmtNum(v.east, 6)}</td><td className="p-2">{v.newVertex ? `Novo vértice ${v.external ? "externo" : "interno"}` : v.matched ? "Vértice original coincidente" : "Sem correspondência externa"}</td></tr>)}</tbody></table></div></div>)}
  </section>;
}