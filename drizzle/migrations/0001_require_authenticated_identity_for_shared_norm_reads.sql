-- O acervo normativo é compartilhado entre todas as contas conectadas.
-- Expressar a exigência de uma identidade autenticada, sem limitar o acervo por autor.
ALTER POLICY norms_select ON public.norms TO authenticated USING (auth.uid() IS NOT NULL);
ALTER POLICY norm_chunks_select ON public.norm_chunks TO authenticated USING (auth.uid() IS NOT NULL);