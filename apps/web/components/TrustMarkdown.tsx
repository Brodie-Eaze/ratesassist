/**
 * TrustMarkdown — server-rendered markdown for trust-centre artefacts.
 *
 * Mirrors components/Markdown.tsx but without the "use client" directive
 * so it can render on the server inside a Next.js App Router page. The
 * trust pages render canonical .md documents (SUB-PROCESSORS.md and
 * eventually PRIVACY-IMPACT-ASSESSMENT.md, INCIDENT-RESPONSE-RUNBOOK.md)
 * — there is no interactivity required, so a server-only renderer is
 * the right boundary.
 *
 * Styling matches the trust pages: ink palette, accent for code, tabular
 * GFM tables for the sub-processor matrix.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function TrustMarkdown({ source }: { source: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-headings:text-ink-900 prose-p:text-ink-700 prose-strong:text-ink-900 prose-code:text-accent-700 prose-code:bg-ink-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-table:text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-2xl font-semibold mt-4 mb-3 tracking-tight">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mt-6 mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold mt-4 mb-2">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="my-2 leading-relaxed">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent-300 pl-3 my-3 text-ink-700 italic">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-accent-600 underline hover:text-accent-700"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="w-full text-sm border-collapse">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-ink-200 bg-ink-50 px-3 py-2 text-left font-medium align-top">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-ink-200 px-3 py-2 align-top">
              {children}
            </td>
          ),
          hr: () => <hr className="my-6 border-ink-100" />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
