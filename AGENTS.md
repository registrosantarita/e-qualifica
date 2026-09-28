<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- O acervo `norms`/`norm_chunks` é legível por qualquer identidade autenticada, mas não por visitantes; é uma biblioteca compartilhada entre usuários conectados.
- A extração de PDFs preserva limites de página para retirar cabeçalhos e rodapés de assinatura repetidos antes da análise; textos intercalados quebram frases e trechos perimetrais.
- No GeoConfronto, um arquivo original pode gerar documentos-filhos independentes por descrição perimétrica, ligados à fonte; apenas a fonte guarda o PDF para evitar uploads e OCR duplicados.
- Exportações geométricas do GeoConfronto são feitas no navegador a partir dos vértices extraídos: KML/KMZ só com lon/lat válidas e DWG com E/N originais ou projeção WGS84 para UTM local, sem inventar coordenadas ausentes.
- A opção “Ignorar confrontações” fica registrada nas tolerâncias de cada comparação GeoConfronto; o motor desconsidera os nomes e o PDF omite a tabela de confrontações, preservando as medidas e o histórico de cada resultado.
- No GeoConfronto, a extração de caminhamentos verifica saltos de códigos e medidas contra coordenadas e perímetro declarado; valores duvidosos permanecem pendentes de conferência, pois inventar medidas propaga erros nas comparações.
- O reprocessamento de uma comparação GeoConfronto cria um novo resultado com os documentos, polígonos e tolerâncias anteriores; mantém o resultado original e registra a ligação na auditoria para preservar revisões humanas.
