import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

export function BatchSelection({ ids, selected, onChange, label, disabled = false }: { ids: string[]; selected: string[]; onChange: (ids: string[]) => void; label: string; disabled?: boolean }) {
  const count = ids.filter(id => selected.includes(id)).length;
  return <div className="flex flex-wrap items-center gap-3">
    <Checkbox aria-label={`Selecionar ${label}`} checked={count === ids.length && count > 0 ? true : count > 0 ? "indeterminate" : false} disabled={disabled || !ids.length} onCheckedChange={checked => onChange(checked === true ? ids : [])} />
    <span className="text-sm">Selecionar {label}</span>
    <Button variant="ghost" size="sm" disabled={disabled || !count} onClick={() => onChange([])}>Limpar seleção</Button>
    <span className="text-xs text-muted-foreground">{count} selecionado(s)</span>
  </div>;
}