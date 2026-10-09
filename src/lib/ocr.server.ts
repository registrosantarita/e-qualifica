/**
 * OCR de documentos digitalizados (PDF sem camada de texto e imagens),
 * via Lovable AI Gateway com modelo multimodal.
 */

function toBase64(bytes: ArrayBuffer): string {
  if (bytes.byteLength === 0) {
    throw new Error("Arquivo indisponível para OCR (conteúdo já consumido). Reenvie o documento.");
  }
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

const PROMPT = [
  "Você é um sistema de OCR de altíssima precisão para documentos registrais e notariais em português do Brasil.",
  "Transcreva INTEGRALMENTE o texto do documento, caractere por caractere, preservando a ordem de leitura,",
  "quebras de linha, parágrafos e tabelas (linhas separadas por ponto e vírgula).",
  "",
  "Regras obrigatórias:",
  "1. Preserve exatamente números, CPF/CNPJ, RG, CEP, datas, matrículas, azimutes (graus, minutos, segundos),",
  "   distâncias, áreas, percentuais e nomes próprios, com a pontuação original (pontos, hífens, barras).",
  "2. E-MAILS: transcreva o endereço completo em uma única sequência, sem espaços, sempre com o caractere '@'",
  "   e o ponto do domínio (ex.: nome.sobrenome@dominio.com.br). Nunca escreva 'arroba', '(a)', '@ ' com espaço,",
  "   nem substitua '@' por 'a', 'à', 'ø' ou '©'. Se houver 'www', 'http' ou '.com', mantenha a forma literal.",
  "3. Letras isoladas e iniciais abreviadas (ex.: 'J.', 'M. de A.') devem ser transcritas como letras,",
  "   nunca convertidas em números ou símbolos. Atenção a confusões típicas: J/1/7, I/l/1, O/0, S/5, B/8, Z/2,",
  "   G/6, rn/m, cl/d. Escolha a leitura que faça sentido no contexto da frase em português.",
  "4. Mantenha acentuação, cedilha, maiúsculas/minúsculas e símbolos como §, º, ª, %, R$, °, ', \".",
  "5. Transcreva também carimbos, selos, rodapés, cabeçalhos, assinaturas legíveis e dados de contato.",
  "6. Se um trecho for realmente ilegível, escreva [ilegível] apenas nesse trecho.",
  "",
  "Não resuma, não corrija, não comente, não traduza e não acrescente nada.",
  "Responda apenas com a transcrição.",
].join("\n");

const MODEL = "google/gemini-3.7-flash";

/** Correções pós-OCR de artefatos recorrentes em endereços de e-mail e sites. */
export function normalizarOcr(text: string): string {
  return (
    text
      // "nome (arroba) dominio" / "nome arroba dominio" -> "nome@dominio"
      .replace(/\s*[([{]?\s*arroba\s*[)\]}]?\s*/gi, "@")
      // espaços ao redor do @ dentro de um e-mail
      .replace(/([A-Za-z0-9._%+-])\s*@\s*([A-Za-z0-9-])/g, "$1@$2")
      // espaços dentro do domínio: "gmail. com. br"
      .replace(/(@[A-Za-z0-9.-]*[A-Za-z0-9])\s*\.\s*(com|net|org|gov|edu|adv|jus|br|inf|eco)\b/gi, "$1.$2")
      .replace(/\b(com|net|org|gov|edu|adv|jus|inf)\s*\.\s*br\b/gi, "$1.br")
      // "www . dominio . com"
      .replace(/\bwww\s*\.\s*/gi, "www.")
      // símbolos comumente confundidos com @ entre partes de um e-mail
      .replace(/([A-Za-z0-9._%+-]{2,})\s*[©øΘ⊙]\s*([A-Za-z0-9-]+\.[A-Za-z]{2,})/g, "$1@$2")
      .replace(/[ \t]+\n/g, "\n")
  );
}

export type OcrUsage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};


export type OcrResult = { text: string; note?: string; usage?: OcrUsage };

export async function ocrDocument(
  bytes: ArrayBuffer,
  extension: string,
  fileName = "documento",
  options: { geoconfronto?: boolean } = {},
): Promise<OcrResult> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) {
    return { text: "", note: "OCR indisponível: chave de IA não configurada." };
  }

  const ext = extension.toLowerCase().replace(".", "");
  const isImage = ext in IMAGE_MIME;
  const mime = IMAGE_MIME[ext] ?? "application/pdf";
  const data = `data:${mime};base64,${toBase64(bytes)}`;
  const prompt = options.geoconfronto ? `${PROMPT}\n\nPara este memorial: transcreva o corpo impresso de TODAS as páginas em ordem, incluindo tabelas e todas as medidas. Não intercale assinaturas manuscritas, rubricas, carimbos de autenticação, números de página ou páginas contendo somente esses elementos no corpo da descrição. Continue frases e medidas interrompidas pela virada de página. Preserve Long/Lat, hemisférios W/S, altitude e códigos completos. Nunca complete valores a partir de outro documento ou pelo contexto. Leia cada dígito da imagem, não reutilize a camada OCR do PDF. Não omita o último segmento de fechamento. Valores ilegíveis devem permanecer [ilegível].` : PROMPT;

  const content = isImage
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: data } },
      ]
    : [
        { type: "text", text: prompt },
        { type: "file", file: { filename: `${fileName}.pdf`, file_data: data } },
      ];

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      top_p: 1,
      messages: [
        {
          role: "system",
          content:
            "Você transcreve documentos com fidelidade literal absoluta, sem interpretar, resumir ou corrigir.",
        },
        { role: "user", content },
      ],
    }),

  });

  if (response.status === 429) {
    return { text: "", note: "Limite de requisições de OCR atingido. Tente novamente em instantes." };
  }
  if (response.status === 402) {
    return { text: "", note: "Créditos de IA esgotados. Recarregue os créditos do workspace para usar o OCR." };
  }
  if (!response.ok) {
    return {
      text: "",
      note: `Falha no OCR (HTTP ${response.status}). Cole o texto do documento manualmente.`,
    };
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    model?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const text = normalizarOcr(json.choices?.[0]?.message?.content ?? "");
  const promptTokens = json.usage?.prompt_tokens ?? 0;
  const completion = json.usage?.completion_tokens ?? 0;
  const usage: OcrUsage = {
    model: json.model ?? MODEL,
    promptTokens,
    completionTokens: completion,
    totalTokens: json.usage?.total_tokens ?? promptTokens + completion,
  };
  if (json.choices?.[0]?.finish_reason === "length") {
    return { text: "", usage, note: "A transcrição foi interrompida antes do fim do PDF. Divida o arquivo em partes e reenvie; nenhuma leitura parcial foi aceita." };
  }
  if (!text.trim()) {
    return { text: "", note: "O OCR não identificou texto legível neste documento.", usage };
  }
  return {
    text,
    usage,
    note: "Texto obtido por OCR assistido por IA. Confira a transcrição antes da qualificação.",
  };

}
