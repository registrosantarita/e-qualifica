ALTER TABLE public.index_records
  ADD COLUMN IF NOT EXISTS source_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS field_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS corrections jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_quality jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.index_records.source_pages IS 'Folhas que compõem a matrícula consolidada, em ordem de leitura.';
COMMENT ON COLUMN public.index_records.field_evidence IS 'Trechos e atos de origem dos valores sugeridos pelo CheckIndex.';
COMMENT ON COLUMN public.index_records.corrections IS 'Valores confirmados manualmente, com responsável e data.';
COMMENT ON COLUMN public.index_records.ocr_quality IS 'Indicadores de qualidade da camada textual e conflitos detectados.';