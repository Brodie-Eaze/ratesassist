import { NextResponse } from "next/server";
import { buildEvidencePack } from "@ratesassist/recovery-engine";
import { getEvaluationContext } from "@/lib/clients";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ file: string }> },
) {
  const { file } = await ctx.params;
  // Strict path-param validation — alphanumerics + dashes, .md or .html.
  if (!/^[A-Z0-9-]{3,40}\.(md|html)$/.test(file)) {
    return NextResponse.json({ error: "invalid file" }, { status: 400 });
  }
  const dot = file.lastIndexOf(".");
  const assessment = file.slice(0, dot);
  const ext = file.slice(dot + 1);

  const result = buildEvidencePack(assessment, getEvaluationContext());
  if (result.kind !== "ok") {
    return NextResponse.json(
      { error: "no pack", reason: result.kind },
      { status: 404 },
    );
  }
  const pack = result.pack;

  if (ext === "md") {
    return new NextResponse(pack.markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${pack.packId}.md"`,
      },
    });
  }
  if (ext === "html") {
    const html = renderHtmlPack(pack.markdown, pack.packId);
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'",
      },
    });
  }
  return NextResponse.json({ error: "unsupported ext" }, { status: 400 });
}

function renderHtmlPack(markdown: string, packId: string): string {
  // Minimal markdown → HTML for the printable evidence pack.
  // Produces a clean, printable page with brand styling.
  // Regex renderer; sufficient for the controlled markdown produced by buildEvidencePack. Will be replaced by a sanitizer-backed library before any production deploy.
  const md = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Simple replacements
  let html = md
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/gs, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n/g, "</p><p>")
    // Table rendering — pipe-separated rows
    .replace(/\|(.+?)\|\n\|[-: |]+\|\n((?:\|.+\|\n?)+)/g, (_, header: string, body: string) => {
      const headers = header.split("|").map((c: string) => c.trim()).filter(Boolean);
      const rows = body
        .trim()
        .split("\n")
        .map((r: string) => r.split("|").map((c: string) => c.trim()).filter(Boolean));
      return `<table><thead><tr>${headers.map((h: string) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
        .map((r: string[]) => `<tr>${r.map((c: string) => `<td>${c}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
    });

  html = `<p>${html}</p>`
    .replace(/<p><h/g, "<h")
    .replace(/<\/h(\d)><\/p>/g, "</h$1>")
    .replace(/<p><ul>/g, "<ul>")
    .replace(/<\/ul><\/p>/g, "</ul>")
    .replace(/<p><table>/g, "<table>")
    .replace(/<\/table><\/p>/g, "</table>")
    .replace(/<p><blockquote>/g, "<blockquote>")
    .replace(/<\/blockquote><\/p>/g, "</blockquote>");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Evidence Pack ${packId} — RatesAssist</title>
<style>
  :root {
    --ink-50: #f7f8fa;
    --ink-200: #dde2ea;
    --ink-500: #5c6878;
    --ink-700: #2c3543;
    --ink-900: #0f141c;
    --accent-600: #1a52d4;
    --accent-100: #d8eaff;
  }
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif !important; }
  body {
    color: var(--ink-900);
    background: white;
    margin: 0;
    padding: 0;
  }
  .container {
    max-width: 780px;
    margin: 0 auto;
    padding: 56px 64px;
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 2px solid var(--ink-900);
    padding-bottom: 12px;
    margin-bottom: 32px;
  }
  .wordmark {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .wordmark span { color: var(--accent-600); }
  .pack-id { font-size: 12px; color: var(--ink-500); }
  h1 { font-size: 24px; margin: 24px 0 12px; letter-spacing: -0.02em; }
  h2 { font-size: 16px; margin: 24px 0 8px; padding-top: 12px; border-top: 1px solid var(--ink-200); }
  h3 { font-size: 13px; margin: 16px 0 4px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-500); }
  p { margin: 6px 0; line-height: 1.55; font-size: 13px; }
  ul { padding-left: 20px; margin: 6px 0; }
  li { margin: 2px 0; font-size: 13px; line-height: 1.55; }
  code { background: var(--ink-50); padding: 1px 5px; border-radius: 3px; font-size: 12px; color: var(--accent-600); }
  table { border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 12px; }
  th, td { border: 1px solid var(--ink-200); padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: var(--ink-50); font-weight: 600; }
  blockquote {
    border-left: 3px solid var(--accent-600);
    background: #f7faff;
    padding: 10px 14px;
    margin: 12px 0;
    font-size: 12.5px;
    line-height: 1.6;
  }
  .footer {
    border-top: 1px solid var(--ink-200);
    padding-top: 16px;
    margin-top: 32px;
    font-size: 11px;
    color: var(--ink-500);
    display: flex;
    justify-content: space-between;
  }
  @media print {
    .container { padding: 24px; }
  }
</style>
</head>
<body>
  <div class="container">
    <div class="brand">
      <div class="wordmark">Rates<span>Assist</span></div>
      <div class="pack-id">${packId}</div>
    </div>
    ${html}
    <div class="footer">
      <span>Generated by RatesAssist · Confidential</span>
      <span>Statutory determination remains with council</span>
    </div>
    <div style="margin-top:24px;text-align:right">
      <button onclick="window.print()" style="padding:6px 14px;border:1px solid #1a52d4;background:#1a52d4;color:white;border-radius:4px;font-size:12px;cursor:pointer">Print</button>
    </div>
  </div>
</body>
</html>`;
}
