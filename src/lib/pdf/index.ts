import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { ValidationError } from "@/lib/errors";

/** Requirement 14.1 — 50 MB ceiling per upload. */
export const MAX_DELIVERABLE_BYTES = 50 * 1024 * 1024;

const PDF_MAGIC = "%PDF-";

export const WATERMARK_TEXT = "PREVIEW";

export interface PdfValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Requirement 14.6 — reject anything that is not a PDF, and anything above the
 * size ceiling, before a single byte is written to storage.
 */
export function validatePdf(buffer: Buffer): PdfValidation {
  if (buffer.byteLength === 0) {
    return { valid: false, reason: "The uploaded file is empty." };
  }
  if (buffer.byteLength > MAX_DELIVERABLE_BYTES) {
    return { valid: false, reason: "File too large: the maximum deliverable size is 50 MB." };
  }
  const header = buffer.subarray(0, 5).toString("latin1");
  if (header !== PDF_MAGIC) {
    return { valid: false, reason: "Invalid format: only PDF deliverables are accepted." };
  }
  const tail = buffer.subarray(Math.max(0, buffer.byteLength - 1024)).toString("latin1");
  if (!tail.includes("%%EOF")) {
    return { valid: false, reason: "Invalid format: the PDF appears to be truncated." };
  }
  return { valid: true };
}

export function assertValidPdf(buffer: Buffer): void {
  const result = validatePdf(buffer);
  if (!result.valid) {
    throw new ValidationError([{ field: "file", message: result.reason ?? "Invalid PDF." }]);
  }
}

/**
 * Requirements 14.3/15.1 — stamps a legible, semi-transparent "PREVIEW" mark
 * diagonally across the full page area of every page.
 */
export async function applyWatermark(pdfBuffer: Buffer): Promise<Buffer> {
  const document = await PDFDocument.load(pdfBuffer, { updateMetadata: false });
  const font = await document.embedFont(StandardFonts.HelveticaBold);

  for (const page of document.getPages()) {
    const { width, height } = page.getSize();
    const fontSize = Math.max(36, Math.min(width, height) * 0.14);
    const stepX = width / 2;
    const stepY = height / 3;

    for (let column = 0; column < 3; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        page.drawText(WATERMARK_TEXT, {
          x: column * stepX - width * 0.1,
          y: row * stepY + height * 0.06,
          size: fontSize,
          font,
          color: rgb(0.72, 0.12, 0.2),
          opacity: 0.22,
          rotate: degrees(35),
        });
      }
    }

    page.drawText("PREVIEW — original file is locked until payment is confirmed.", {
      x: width * 0.05,
      y: 12,
      size: Math.max(7, Math.min(11, width * 0.012)),
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: 0.9,
    });
  }

  const bytes = await document.save();
  return Buffer.from(bytes);
}

export async function countPdfPages(buffer: Buffer): Promise<number> {
  const document = await PDFDocument.load(buffer, { updateMetadata: false });
  return document.getPageCount();
}
