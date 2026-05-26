/**
 * Council-grade PDF renderer for the reclassification evidence pack.
 *
 * Why pdfkit (not @react-pdf/renderer or puppeteer-core):
 *   - pdfkit is a pure-Node imperative library (no Chromium, no React) with
 *     a ~1MB install footprint. Cold-start on a Node serverless function is
 *     in the tens of milliseconds, not seconds.
 *   - The evidence pack is a long-form statutory document with deterministic
 *     layout — tables, signal rows, an attestation footer. None of that
 *     needs the pixel-perfect rendering puppeteer-core offers (which would
 *     bloat the Lambda image by ~50MB for headless Chromium); selectable
 *     text is more important than HTML fidelity to a council finance team
 *     that will print, sign, and file the document.
 *   - @react-pdf/renderer ships a parallel React reconciler; the cognitive
 *     overhead of two render trees for a one-page-style document is not
 *     worth the declarative benefit at this surface area. If we later need
 *     React-driven PDF templates (e.g. notices with charts) we'll swap in
 *     @react-pdf/renderer at that boundary.
 *
 * The renderer reads the structured {@link EvidencePack} (not the markdown
 * blob) so the layout can be controlled: tables sit on their own rows, the
 * signal trail is rendered as a numbered list with weight badges, the QR
 * code lands in the cover header. The markdown body is preserved unchanged
 * as the .md/.html download path; this module is the .pdf path.
 *
 * The PDF is rendered to a Buffer in-memory (pdfkit's stream emits chunks).
 * For the council pilot scale (≤ 10 packs/day per council) buffering the
 * entire document is appropriate; for higher-throughput exports we would
 * pipe directly to the response stream.
 */

import PDFDocument from "pdfkit";
import QRCode from "qrcode";

import type { EvidencePack } from "@ratesassist/recovery-engine";

/** Inputs the renderer needs that aren't on the EvidencePack itself. */
export interface RenderEvidencePdfInput {
  readonly pack: EvidencePack;
  /** Display name of the council (e.g. "Shire of Tom Price"). */
  readonly councilName: string;
  /** Display name of the operator who generated the PDF. From session. */
  readonly operatorName: string;
  /** Absolute URL of the live HTML evidence pack — encoded as QR. */
  readonly evidenceUrl: string;
}

// ---------------------------------------------------------------------------
// Palette + layout constants. Kept here (not in CSS) because pdfkit takes
// numeric coords; mirroring the on-screen palette so a printed PDF reads as
// the same brand as the HTML pack.
// ---------------------------------------------------------------------------
const INK_900 = "#0f141c";
const INK_700 = "#2c3543";
const INK_500 = "#5c6878";
const INK_200 = "#dde2ea";
const ACCENT = "#1a52d4";
const WARN_BG = "#fff7e6";
const WARN_TEXT = "#8a4b00";

const PAGE_MARGIN = 56;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2; // A4 width minus margins.

/**
 * Render `input` to a PDF byte buffer. Resolves once the document stream
 * has fully ended (pdfkit emits chunks asynchronously).
 *
 * Errors thrown by pdfkit (e.g. font load failure) propagate; the caller
 * should treat them as a 500 — the route layer does this.
 */
export async function renderEvidencePdf(
  input: RenderEvidencePdfInput,
): Promise<Buffer> {
  const { pack, councilName, operatorName, evidenceUrl } = input;
  // QR is generated as a 1-bit PNG at modest size — pdfkit's `image` then
  // embeds it losslessly. Failure to generate the QR is non-fatal — the
  // pack still has value without it; we proceed with a null and skip the
  // image block.
  const qrPng = await renderQrPngSafe(evidenceUrl);

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    info: {
      Title: `Evidence Pack ${pack.packId}`,
      Author: `RatesAssist · ${operatorName}`,
      Subject: `Reclassification evidence — ${pack.candidate.property.assessmentNumber}`,
      Creator: "RatesAssist",
      Producer: "RatesAssist",
      CreationDate: new Date(),
    },
    // Disable the bundled AFM font autoload-by-name; we exclusively use
    // the built-in Helvetica family below. Explicit so pdfkit doesn't
    // probe for system fonts at render time.
    autoFirstPage: false,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.addPage();
  drawCover(doc, pack, councilName, operatorName, qrPng);
  drawPropertyIdentity(doc, pack);
  drawSignalTrail(doc, pack);
  drawCompositeAndUplift(doc, pack);
  drawFooterOnEveryPage(doc, councilName);

  doc.end();
  return done;
}

// ---------------------------------------------------------------------------
// Section renderers.
// ---------------------------------------------------------------------------

function drawCover(
  doc: PDFKit.PDFDocument,
  pack: EvidencePack,
  councilName: string,
  operatorName: string,
  qrPng: Buffer | null,
): void {
  const { candidate, packId, generatedAt } = pack;
  const property = candidate.property;

  // Council letterhead — text only (no logo by design; finance team adds
  // their own crest on the printed copy).
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(INK_500)
    .text(councilName.toUpperCase(), PAGE_MARGIN, PAGE_MARGIN, {
      characterSpacing: 1.2,
    });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(INK_500)
    .text("Statutory rate classification evidence pack", { lineGap: 1 });

  // Rule under letterhead.
  doc
    .strokeColor(INK_900)
    .lineWidth(1.5)
    .moveTo(PAGE_MARGIN, PAGE_MARGIN + 32)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, PAGE_MARGIN + 32)
    .stroke();

  // Main title.
  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor(INK_900)
    .text("Reclassification Evidence Pack", PAGE_MARGIN, PAGE_MARGIN + 50, {
      width: CONTENT_WIDTH - 110, // leave room for the QR on the right
    });

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(INK_500)
    .text(
      `Assessment ${property.assessmentNumber} · severity ${candidate.severity.toUpperCase()} · ${formatPercent(candidate.compositeScore)} composite confidence`,
      { width: CONTENT_WIDTH - 110 },
    );

  // QR (top-right) — links back to the live HTML evidence pack.
  if (qrPng !== null) {
    const qrSize = 96;
    const qrX = PAGE_MARGIN + CONTENT_WIDTH - qrSize;
    const qrY = PAGE_MARGIN + 50;
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(INK_500)
      .text("Scan for live evidence URL", qrX, qrY + qrSize + 2, {
        width: qrSize,
        align: "center",
      });
  }

  // Metadata block — pack id, generated at, operator, council.
  doc.y = Math.max(doc.y, PAGE_MARGIN + 170);
  doc.x = PAGE_MARGIN;

  drawKeyValueBlock(doc, [
    ["Pack ID", packId],
    ["Generated at", `${generatedAt} (UTC)`],
    ["Operator", operatorName],
    ["Council", councilName],
    ["Property", `${property.address}, ${property.suburb} ${property.postcode} ${property.state}`],
  ]);
}

function drawPropertyIdentity(
  doc: PDFKit.PDFDocument,
  pack: EvidencePack,
): void {
  ensureSpace(doc, 140);
  drawSectionHeading(doc, "Property identity");
  const property = pack.candidate.property;
  const lotPlan = property.pins?.[0]?.lotPlan ?? "(lot / plan not on file)";
  const ven = property.ven ?? "(VEN not on file)";

  drawKeyValueBlock(doc, [
    ["Assessment number", property.assessmentNumber],
    ["Address", `${property.address}, ${property.suburb} ${property.postcode} ${property.state}`],
    ["Suburb", property.suburb],
    ["Lot / Plan", lotPlan],
    ["VEN", ven],
    ["Current rating category", property.landUse],
    ["Valuation", formatAud(property.valuation)],
    ["Current annual rates", formatAud(property.annualRates)],
  ]);
}

function drawSignalTrail(doc: PDFKit.PDFDocument, pack: EvidencePack): void {
  ensureSpace(doc, 120);
  drawSectionHeading(doc, "Detection signal trail");
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor(INK_700)
    .text(
      "Each signal below is sourced from an authoritative public or commercial dataset and is weighted by historical reliability. Signals are listed in descending order of weight.",
      { width: CONTENT_WIDTH, lineGap: 1 },
    );
  doc.moveDown(0.4);

  pack.prioritisedSignals.forEach((sig, ix) => {
    ensureSpace(doc, 60);
    const startY = doc.y;

    // Index pill on the left.
    const pillSize = 18;
    doc
      .roundedRect(PAGE_MARGIN, startY + 1, pillSize, pillSize, 3)
      .fillAndStroke(ACCENT, ACCENT);
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#ffffff")
      .text(String(ix + 1), PAGE_MARGIN, startY + 5, {
        width: pillSize,
        align: "center",
      });

    const textX = PAGE_MARGIN + pillSize + 8;
    const textWidth = CONTENT_WIDTH - pillSize - 8;

    doc
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .fillColor(INK_900)
      .text(sig.short, textX, startY, { width: textWidth, continued: true })
      .font("Helvetica")
      .fontSize(9)
      .fillColor(INK_500)
      .text(`   weight ${sig.weight.toFixed(2)} · ${sig.category}`, {
        width: textWidth,
      });

    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(INK_700)
      .text(sig.evidence, textX, doc.y + 2, { width: textWidth, lineGap: 1 });

    doc
      .font("Helvetica-Oblique")
      .fontSize(8.5)
      .fillColor(INK_500)
      .text(`Source: ${sig.source}`, textX, doc.y + 1, { width: textWidth });

    doc.moveDown(0.5);
  });
}

function drawCompositeAndUplift(
  doc: PDFKit.PDFDocument,
  pack: EvidencePack,
): void {
  ensureSpace(doc, 200);
  drawSectionHeading(doc, "Composite score, uplift and arrears");
  const candidate = pack.candidate;

  drawKeyValueBlock(doc, [
    ["Composite confidence", formatPercent(candidate.compositeScore)],
    ["Severity", candidate.severity.toUpperCase()],
    ["Signals fired", String(candidate.signals.length)],
    ["Current annual rates", formatAud(candidate.property.annualRates)],
    [
      "Estimated annual rates (proposed category)",
      formatAud(candidate.estAnnualRatesNew),
    ],
    ["Estimated annual uplift", formatAud(candidate.estUplift)],
    [
      "Estimated arrears (3-year conservative)",
      formatAud(candidate.estArrears3y),
    ],
  ]);

  // Caveat strip — councils must understand AI involvement is advisory.
  doc.moveDown(0.4);
  ensureSpace(doc, 60);
  const caveatY = doc.y;
  const caveatHeight = 44;
  doc
    .rect(PAGE_MARGIN, caveatY, CONTENT_WIDTH, caveatHeight)
    .fillAndStroke(WARN_BG, "#f3d99a");
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(WARN_TEXT)
    .text("Statutory determination notice", PAGE_MARGIN + 10, caveatY + 8, {
      width: CONTENT_WIDTH - 20,
    });
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(WARN_TEXT)
    .text(
      "Scoring and uplift estimates are deterministic and reproducible. AI involvement is limited to narration. Statutory determination of the rate category remains with the council finance officer; this pack is advisory and must be reviewed before any notice is issued to the ratepayer.",
      PAGE_MARGIN + 10,
      caveatY + 20,
      { width: CONTENT_WIDTH - 20, lineGap: 1 },
    );
  doc.y = caveatY + caveatHeight + 8;
}

/**
 * Page footer drawn on the bottom of every page. pdfkit doesn't have a
 * "footer template" — we hook `pageAdded` AFTER `addPage` so we draw it on
 * the current page, then on each subsequent page.
 */
function drawFooterOnEveryPage(
  doc: PDFKit.PDFDocument,
  councilName: string,
): void {
  const drawFooter = (): void => {
    const pageHeight = doc.page.height;
    const footerY = pageHeight - PAGE_MARGIN + 12;
    const prevY = doc.y;
    const prevX = doc.x;
    doc
      .strokeColor(INK_200)
      .lineWidth(0.5)
      .moveTo(PAGE_MARGIN, footerY)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, footerY)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(INK_500)
      .text(
        `Generated by RatesAssist on behalf of ${councilName}. Statutory determination requires council finance officer review.`,
        PAGE_MARGIN,
        footerY + 4,
        { width: CONTENT_WIDTH, align: "center", lineGap: 0 },
      );
    doc.x = prevX;
    doc.y = prevY;
  };

  // Draw on the current (cover) page first.
  drawFooter();
  doc.on("pageAdded", drawFooter);
}

// ---------------------------------------------------------------------------
// Primitives.
// ---------------------------------------------------------------------------

/**
 * Two-column key/value block. Left column is fixed-width, right column
 * wraps within the remaining content width. Rows are drawn top-down from
 * the current `doc.y`.
 */
function drawKeyValueBlock(
  doc: PDFKit.PDFDocument,
  rows: ReadonlyArray<readonly [string, string]>,
): void {
  const labelWidth = 200;
  const valueWidth = CONTENT_WIDTH - labelWidth - 8;
  const rowGap = 4;

  for (const [label, value] of rows) {
    ensureSpace(doc, 24);
    const rowStartY = doc.y;
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(INK_500)
      .text(label, PAGE_MARGIN, rowStartY, { width: labelWidth, lineGap: 1 });

    // Capture label height before overwriting doc.y.
    const labelEndY = doc.y;

    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor(INK_900)
      .text(value, PAGE_MARGIN + labelWidth + 8, rowStartY, {
        width: valueWidth,
        lineGap: 1,
      });

    const valueEndY = doc.y;
    doc.y = Math.max(labelEndY, valueEndY) + rowGap;
  }
  doc.moveDown(0.3);
}

function drawSectionHeading(doc: PDFKit.PDFDocument, label: string): void {
  doc.moveDown(0.6);
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(INK_900)
    .text(label, { width: CONTENT_WIDTH });

  // Underline.
  const y = doc.y + 2;
  doc
    .strokeColor(ACCENT)
    .lineWidth(1)
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + 60, y)
    .stroke();
  doc.y = y + 8;
}

/**
 * If less than `needed` points of vertical space remain on the current
 * page (above the footer band), force a new page. Used at the top of
 * each section + before each signal row so a section heading is never
 * orphaned at the bottom of a page.
 */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const footerBand = PAGE_MARGIN + 28; // leave space for the footer text.
  const pageBottom = doc.page.height - footerBand;
  if (doc.y + needed > pageBottom) {
    doc.addPage();
  }
}

// ---------------------------------------------------------------------------
// Formatting + QR helpers.
// ---------------------------------------------------------------------------

function formatAud(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

function formatPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Render a QR code to a 1-bit PNG buffer. Returns null on failure (the
 * caller renders the document without the QR rather than 500ing — the
 * QR is a convenience, not statutory content).
 */
async function renderQrPngSafe(text: string): Promise<Buffer | null> {
  try {
    return await QRCode.toBuffer(text, {
      type: "png",
      width: 256,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: INK_900, light: "#ffffff" },
    });
  } catch {
    return null;
  }
}
