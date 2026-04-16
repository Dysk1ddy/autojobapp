import { describe, expect, it } from "vitest";
import {
  detectResumeFileKind,
  extractTextFromDocxXml,
  joinPdfTextItems
} from "./resume-file-helpers";

describe("resume-file-helpers", () => {
  it("detects supported local resume file types", () => {
    expect(detectResumeFileKind("resume.docx", "")).toBe("docx");
    expect(detectResumeFileKind("resume.pdf", "")).toBe("pdf");
    expect(detectResumeFileKind("resume.txt", "text/plain")).toBe("text");
    expect(detectResumeFileKind("resume.rtf", "application/rtf")).toBe(
      "unsupported"
    );
  });

  it("extracts readable text from DOCX xml blocks", () => {
    const xml = `
      <w:document>
        <w:body>
          <w:p><w:r><w:t>Taylor Applicant</w:t></w:r></w:p>
          <w:p><w:r><w:t>Northwind Labs</w:t></w:r></w:p>
          <w:p><w:r><w:t>Software Engineer</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `;

    expect(extractTextFromDocxXml(xml)).toContain("Taylor Applicant");
    expect(extractTextFromDocxXml(xml)).toContain("Northwind Labs");
  });

  it("joins PDF text items into normalized text", () => {
    expect(joinPdfTextItems(["Taylor", "Applicant", "Software", "Engineer"])).toBe(
      "Taylor Applicant Software Engineer"
    );
  });
});
