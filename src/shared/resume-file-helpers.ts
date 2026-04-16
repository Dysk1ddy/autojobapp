export type ResumeFileKind = "text" | "pdf" | "docx" | "unsupported";

export function detectResumeFileKind(
  fileName: string,
  mimeType: string
): ResumeFileKind {
  const normalizedName = fileName.toLowerCase();
  const normalizedMimeType = mimeType.toLowerCase();

  if (
    normalizedName.endsWith(".docx") ||
    normalizedMimeType.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
  ) {
    return "docx";
  }

  if (
    normalizedName.endsWith(".pdf") ||
    normalizedMimeType.includes("application/pdf")
  ) {
    return "pdf";
  }

  if (
    normalizedName.endsWith(".txt") ||
    normalizedMimeType.startsWith("text/")
  ) {
    return "text";
  }

  return "unsupported";
}

export function extractTextFromDocxXml(xml: string): string {
  if (!xml.trim()) {
    return "";
  }

  return normalizeImportedResumeText(
    decodeXmlEntities(
      xml
        .replace(/<w:tab\/>/g, " ")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<\/w:tr>/g, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

export function joinPdfTextItems(items: string[]): string {
  return normalizeImportedResumeText(items.join(" "));
}

export function normalizeImportedResumeText(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#xA;/gi, "\n")
    .replace(/&#10;/g, "\n")
    .replace(/&#x9;/gi, " ")
    .replace(/&#9;/g, " ");
}
