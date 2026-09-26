ALTER TABLE public.documents ADD COLUMN source_document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE;
ALTER TABLE public.documents ADD COLUMN source_parcel_index integer;
CREATE UNIQUE INDEX documents_source_parcel_unique ON public.documents(source_document_id, source_parcel_index) WHERE source_document_id IS NOT NULL;
COMMENT ON COLUMN public.documents.source_document_id IS 'Original uploaded document containing this extracted perimeter description';
COMMENT ON COLUMN public.documents.source_parcel_index IS 'Zero-based order of the description in the original document';