import {
  detectResumeFileKind,
  extractTextFromDocxXml,
  joinPdfTextItems,
  normalizeImportedResumeText
} from "./resume-file-helpers";

export interface ResumeFileExtractionResult {
  text: string;
  fileName: string;
  mimeType: string;
  parserLabel: "plain-text" | "pdfjs" | "docx-xml";
  warnings: string[];
}

interface JsZipEntry {
  name: string;
  async: (type: "string") => Promise<string>;
}

interface JsZipArchive {
  file: (pattern: RegExp) => JsZipEntry[];
}

interface JsZipConstructor {
  loadAsync: (data: ArrayBuffer) => Promise<JsZipArchive>;
}

let jsZipConstructorPromise: Promise<JsZipConstructor> | null = null;
let pdfJsModulePromise: Promise<{
  GlobalWorkerOptions: typeof import("pdfjs-dist").GlobalWorkerOptions;
  getDocument: typeof import("pdfjs-dist").getDocument;
}> | null = null;

export async function extractTextFromResumeFile(
  file: File
): Promise<ResumeFileExtractionResult> {
  const bytes = await file.arrayBuffer();
  const kind = detectResumeFileKind(file.name, file.type);

  switch (kind) {
    case "text":
      return {
        text: normalizeImportedResumeText(new TextDecoder("utf-8").decode(bytes)),
        fileName: file.name,
        mimeType: file.type || "text/plain",
        parserLabel: "plain-text",
        warnings: []
      };

    case "docx":
      return extractTextFromDocxFile(file, bytes);

    case "pdf":
      return extractTextFromPdfFile(file, bytes);

    default:
      throw new Error(
        "Unsupported resume file type. Use a .txt, .pdf, or .docx file."
      );
  }
}

async function extractTextFromDocxFile(
  file: File,
  bytes: ArrayBuffer
): Promise<ResumeFileExtractionResult> {
  const JSZip = await loadJsZipConstructor();
  const archive = await JSZip.loadAsync(bytes);
  const xmlFiles = archive
    .file(/word\/(header\d+|document|footer\d+)\.xml$/)
    .sort((left: JsZipEntry, right: JsZipEntry) =>
      left.name.localeCompare(right.name)
    );
  const xmlBlocks = await Promise.all(
    xmlFiles.map((entry) => entry.async("string"))
  );
  const text = normalizeImportedResumeText(
    xmlBlocks.map(extractTextFromDocxXml).filter(Boolean).join("\n\n")
  );

  return {
    text,
    fileName: file.name,
    mimeType:
      file.type ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    parserLabel: "docx-xml",
    warnings:
      text.length > 0
        ? []
        : ["No readable text was extracted from the DOCX file."]
  };
}

async function extractTextFromPdfFile(
  file: File,
  bytes: ArrayBuffer
): Promise<ResumeFileExtractionResult> {
  const { GlobalWorkerOptions, getDocument } = await loadPdfJsModule();
  const task = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false
  });

  try {
    const pdf = await task.promise;
    const pages: string[] = [];

    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const content = await page.getTextContent();
      const items = content.items
        .map((item) =>
          "str" in item && typeof item.str === "string" ? item.str : ""
        )
        .filter(Boolean);

      pages.push(joinPdfTextItems(items));
    }

    const text = normalizeImportedResumeText(pages.join("\n\n"));

    return {
      text,
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      parserLabel: "pdfjs",
      warnings:
        text.length > 0
          ? []
          : [
              "The PDF parsed, but no selectable text was found. Scanned-image resumes may need manual copy or OCR first."
            ]
    };
  } finally {
    await task.destroy();
  }
}

async function loadJsZipConstructor(): Promise<JsZipConstructor> {
  if (!jsZipConstructorPromise) {
    jsZipConstructorPromise = import("jszip").then(
      (module) => (module as { default: JsZipConstructor }).default
    );
  }

  return jsZipConstructorPromise;
}

async function loadPdfJsModule(): Promise<{
  GlobalWorkerOptions: typeof import("pdfjs-dist").GlobalWorkerOptions;
  getDocument: typeof import("pdfjs-dist").getDocument;
}> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = (async () => {
      const [{ GlobalWorkerOptions, getDocument }, { default: pdfWorkerUrl }] =
        await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url")
        ]);

      GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

      return {
        GlobalWorkerOptions,
        getDocument
      };
    })();
  }

  return pdfJsModulePromise;
}
