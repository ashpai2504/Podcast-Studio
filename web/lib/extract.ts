/**
 * Client-side document text extraction (PDF, DOCX, PPTX, XLSX/XLSM, plain
 * text). Runs entirely in the browser so large files never need to cross the
 * network as raw bytes - only the extracted text does.
 *
 * Ported from podcast_studio/extractors.py.
 */

// CRM/Salesforce exports (e.g. Hunter's MAR Excel exports) embed literal
// carriage-return escapes.
const CRM_ARTIFACT = /_x000D_/g;

export async function extractText(file: File): Promise<string> {
  const name = file.name;
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  try {
    let text: string;
    if (ext === ".pdf") {
      text = await extractPdf(file);
    } else if (ext === ".docx") {
      text = await extractDocx(file);
    } else if (ext === ".pptx") {
      text = await extractPptx(file);
    } else if (ext === ".xlsx" || ext === ".xlsm") {
      text = await extractXlsx(file);
    } else {
      text = await file.text();
    }
    return text.replace(CRM_ARTIFACT, "");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `[Could not read ${name}: ${message}]`;
  }
}

async function extractPdf(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url
  ).toString();
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n");
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value;
}

async function extractPptx(file: File): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
      return na - nb;
    });
  const parser = new DOMParser();
  const parts: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async("string");
    const doc = parser.parseFromString(xml, "application/xml");
    const texts = Array.from(doc.getElementsByTagName("a:t")).map((n) => n.textContent ?? "");
    parts.push(`--- Slide ${i + 1} ---`, texts.join("\n"));
  }
  return parts.join("\n");
}

async function extractXlsx(file: File): Promise<string> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    parts.push(`--- Sheet: ${sheetName} ---`);
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
    for (const row of rows) {
      const cells = row
        .filter((c) => c !== null && c !== undefined && c !== "")
        .map((c) => String(c));
      if (cells.length) parts.push(cells.join("\t"));
    }
  }
  return parts.join("\n");
}
