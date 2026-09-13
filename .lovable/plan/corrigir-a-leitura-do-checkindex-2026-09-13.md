# Corrigir a leitura do CheckIndex

## Diagnóstico confirmado

- Os nove PDFs enviados são folhas sucessivas da mesma **Matrícula 1**, encerrada no ato 27, e devem produzir um único registro.
- Hoje, cada arquivo enviado cria imediatamente um registro independente. Assim, folhas intermediárias são interpretadas como matrículas completas.
- Os PDFs já contêm camada de texto, mas ela possui erros típicos de OCR, como `ANCRA`, `NIRE`, `CAPELLAR!` e cabeçalhos parcialmente ilegíveis.
- O sistema aceita qualquer camada de texto com mais de 40 caracteres e não avalia sua qualidade.
- Depois disso, o CheckIndex usa apenas expressões fixas. Ele procura rótulos como “adquirente” e “transmitente”, embora as matrículas normalmente usem frases como “foi adquirido por” e “por compra feita a”.
- A leitura atual também busca o primeiro dado encontrado em vários campos. Para a matrícula completa, deveria prevalecer o dado mais recente e válido na sequência dos atos.

## O que será implementado

### 1. Agrupar automaticamente as folhas

- Tratar uma seleção de vários PDFs como um conjunto antes de criar registros.
- Identificar matrícula, folha, verso e continuidade em cada arquivo.
- Ordenar as páginas por folha e frente/verso.
- Reunir automaticamente arquivos da mesma matrícula em um único documento lógico.
- Mostrar a composição encontrada antes da confirmação, permitindo corrigir um agrupamento excepcional.

### 2. Avaliar a qualidade do texto OCR

- Verificar sinais de texto corrompido: excesso de símbolos, siglas registrais deformadas, baixa proporção de palavras reconhecíveis e marcadores de atos inconsistentes.
- Usar diretamente a camada existente quando estiver adequada, sem custo de IA.
- Quando a qualidade estiver insuficiente, oferecer nova leitura assistida e informar previamente que ela consome créditos.
- Preservar separadamente o texto original e o texto normalizado para auditoria.

### 3. Interpretar a matrícula por atos e cronologia

- Separar abertura, registros e averbações em blocos, tolerando formas como `R.23/M.1`, `Av.27/M.1`, hífens, barras, zeros e pequenas falhas de OCR.
- Extrair as partes pelas construções registrais reais: “foi adquirido por”, “por compra feita a”, “em favor de”, “renunciou”, “cancelada”, “passou a assinar” e equivalentes.
- Consolidar titulares atuais e anteriores conforme transmissões, alterações de estado civil, óbitos, cancelamentos e encerramento.
- Para campos atualizáveis — área, cadastro rural, denominação, último ato, ficha e titulares — usar o último ato aplicável, mantendo o histórico.
- Relacionar ônus e cancelamentos ao ato de origem, sem depender apenas da proximidade textual.
- Aplicar normalizações seguras para erros recorrentes de OCR sem “corrigir” nomes ou números por adivinhação.

### 4. Criar a tela de conferência com origem do dado

- Apresentar um único registro consolidado por matrícula.
- Para cada campo, exibir o valor sugerido, o ato de origem e o trecho literal do PDF.
- Destacar campos duvidosos, conflitantes ou não encontrados.
- Permitir editar todos os campos, titulares, atos e ônus antes de marcar como revisado.
- Registrar valor sugerido, valor confirmado, responsável e data da correção.
- Usar as correções como casos de validação para aprimorar regras futuras; elas não serão apresentadas como “treinamento automático” de um modelo.

### 5. Validar com os nove PDFs enviados

O caso de referência deverá resultar, no mínimo, em:

- um único registro para a Matrícula 1;
- páginas ordenadas até a folha 05;
- último ato numérico `27`;
- natureza rural;
- identificação dos atos R/Av e respectivos cancelamentos;
- leitura dos dados cadastrais mais recentes;
- matrícula marcada como encerrada, com referência à Matrícula 19.728;
- titulares e situações derivados da cadeia registral, sempre sujeitos à conferência humana.

Também serão criados testes com o texto real desses documentos, cobrindo variações de OCR e impedindo que correções futuras quebrem este caso.

## Resultado esperado

O CheckIndex passará de “um PDF = um registro baseado em palavras exatas” para “uma matrícula completa = folhas agrupadas, atos ordenados, dados consolidados e conferência rastreável”. Ele continuará apoiando a indexação, sem substituir a validação do Oficial.

## Detalhes técnicos

- Ajustar o envio em lote para extrair primeiro e persistir somente após agrupamento e consolidação.
- Evoluir o parser para uma estrutura intermediária por página e por ato.
- Acrescentar armazenamento de páginas, trechos de origem, confiança, conflitos e correções humanas, com acesso restrito ao usuário e administradores.
- Manter CSV, XLSX e JSON compatíveis com as colunas atuais do CheckIndex.
- Reprocessar registros antigos somente por comando explícito, preservando os dados já conferidos.
