/**
 * Public security-posture page.
 *
 * Renders the controls a council Privacy Officer / IT Manager will check
 * before approving the pilot. Cross-references the canonical sources
 * (PIA, sub-processor list, incident-response runbook) rather than
 * restating them.
 *
 * Every claim on this page maps to an artefact in the repository so the
 * page does not drift. Update both when the underlying control changes.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { TrustPageShell } from "@/components/PublicLayout";

export const metadata: Metadata = {
  title: "Security posture — RatesAssist",
  description:
    "Encryption, authentication, RBAC, audit logging, vulnerability management, multi-tenant isolation, sub-processors, and certification roadmap.",
};

interface ControlBlock {
  readonly id: string;
  readonly title: string;
  readonly body: React.ReactNode;
}

const CONTROLS: ReadonlyArray<ControlBlock> = [
  {
    id: "encryption",
    title: "Encryption",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>TLS 1.3 in transit, with HSTS preload enforced at the edge.</li>
        <li>
          AES-256 at rest for application storage and the per-tenant audit
          chain.
        </li>
        <li>
          Cryptographic key rotation on a 90-day cycle; out-of-cycle rotation
          on any suspected compromise. Rotations are logged to the audit
          chain.
        </li>
      </ul>
    ),
  },
  {
    id: "authentication",
    title: "Authentication",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Enterprise SSO is on the Phase 4 roadmap via WorkOS (SAML / OIDC
          to Microsoft Entra ID, Google Workspace, or any IdP a council
          operates).
        </li>
        <li>
          Session cookies are HMAC-signed with a server-side secret, marked
          HttpOnly and SameSite=Lax, and rotated on every login.
        </li>
        <li>
          The development autologin escape hatch is gated to non-admin
          roles only and refuses cross-tenant tenant IDs at the env layer.
          It is disabled in production tenancies and explicitly disclosed
          in the pilot MoU.
        </li>
      </ul>
    ),
  },
  {
    id: "authorisation",
    title: "Authorisation",
    body: (
      <>
        <p>
          Role-based access control across four roles, evaluated on every
          request:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <span className="font-mono text-accent-700">rates_officer</span> —
            read tenant data, draft mutations.
          </li>
          <li>
            <span className="font-mono text-accent-700">
              rates_supervisor
            </span>{" "}
            — read tenant data, draft and commit mutations.
          </li>
          <li>
            <span className="font-mono text-accent-700">council_admin</span>{" "}
            — tenant user management.
          </li>
          <li>
            <span className="font-mono text-accent-700">platform_admin</span>{" "}
            — platform-wide administration; cross-tenant scoped to support
            operations only.
          </li>
        </ul>
        <p className="mt-2">
          Every route derives its tenant from the validated session and
          asserts that against the resource tenant before reading or
          writing.
        </p>
      </>
    ),
  },
  {
    id: "audit-logging",
    title: "Audit logging",
    body: (
      <>
        <p>
          Tamper-evident hash-chain audit log, scoped per tenant and
          persisted in Postgres. Each row carries a canonicalised payload
          and a SHA-256 hash that links to the prior row; the chain head is
          verifiable on demand via the{" "}
          <span className="font-mono text-accent-700">verify_audit_chain</span>{" "}
          tool and the corresponding REST endpoint.
        </p>
        <p className="mt-2">
          Retention is 7 years to satisfy the State Records Act 2000 (WA)
          and council record-keeping plans. Production-grade append-only
          storage (AWS QLDB or S3 Object Lock) is on the Phase 6 hardening
          plan; until then the chain is verifiable and exportable but the
          underlying store is mutable by privileged operators.
        </p>
      </>
    ),
  },
  {
    id: "vulnerability-management",
    title: "Vulnerability management",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          External penetration test scheduled quarterly, with the next
          engagement booked for Phase 6 production hardening.
        </li>
        <li>
          Dependabot raises automated dependency-update pull requests; a
          policy-gated reviewer approves before merge.
        </li>
        <li>
          <span className="font-mono">npm audit</span> runs in CI on every
          push and gates merges to the protected branch.
        </li>
        <li>
          A coordinated disclosure mailbox accepts reports at{" "}
          <a
            href="mailto:security@ratesassist.com.au"
            className="text-accent-600 underline hover:text-accent-700"
          >
            security@ratesassist.com.au
          </a>
          .
        </li>
      </ul>
    ),
  },
  {
    id: "multi-tenant-isolation",
    title: "Multi-tenant isolation",
    body: (
      <p>
        Every route derives its tenant identifier from the validated
        session header injected by middleware — never from a query string,
        request body, or client-controlled cookie. Cross-tenant access
        attempts respond with a generic 404 (no enumeration oracle) and
        emit an audit-grade Sentry event tagged with the actor, the
        requested resource, and the correlation ID for forensic
        reconstruction. Cache keys are tenant-prefixed; background jobs
        carry the originating tenant in their payload.
      </p>
    ),
  },
  {
    id: "sub-processors",
    title: "Sub-processors",
    body: (
      <p>
        The current sub-processor list is maintained at{" "}
        <Link
          href="/trust/sub-processors"
          className="text-accent-600 underline hover:text-accent-700"
        >
          /trust/sub-processors
        </Link>
        . Council customers receive at least 30 days' written notice of
        any new sub-processor that will process council-supplied personal
        information, and may object on reasonable grounds.
      </p>
    ),
  },
  {
    id: "certifications",
    title: "Certifications and roadmap",
    body: (
      <>
        <p>
          <span className="font-semibold">Currently held:</span> none.
          RatesAssist is a pre-pilot platform; we will not represent
          certifications that have not been audited.
        </p>
        <p className="mt-2">
          <span className="font-semibold">In progress:</span>
        </p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>SOC 2 Type I — engagement scheduled for Q3 2026.</li>
          <li>ISO/IEC 27001 — engagement scheduled for Q4 2026.</li>
        </ul>
        <p className="mt-2">
          Audit reports and the bridging letter will be available to
          councils under NDA on request.
        </p>
      </>
    ),
  },
];

export default function SecurityPage() {
  return (
    <TrustPageShell
      eyebrow="Trust"
      title="Security posture"
      intro={
        <p>
          The controls below describe how RatesAssist protects
          council-supplied data. Each section maps to a canonical artefact
          (the Privacy Impact Assessment, the Sub-Processor list, or the
          Incident Response Runbook) that councils may request during
          procurement.
        </p>
      }
    >
      {CONTROLS.map((c) => (
        <section key={c.id} id={c.id} aria-labelledby={`${c.id}-heading`}>
          <h2
            id={`${c.id}-heading`}
            className="text-xl font-semibold tracking-tight text-ink-900"
          >
            {c.title}
          </h2>
          <div className="mt-3 text-ink-700">{c.body}</div>
        </section>
      ))}

      <section
        id="security-report"
        aria-labelledby="security-report-heading"
        className="rounded-xl border border-accent-100 bg-accent-50 p-6"
      >
        <h2
          id="security-report-heading"
          className="text-xl font-semibold tracking-tight text-ink-900"
        >
          Request a security report
        </h2>
        <p className="mt-3 text-ink-700">
          Councils can request the latest internal security report, the
          Privacy Impact Assessment, the Sub-Processor list, the Incident
          Response Runbook, and the in-progress SOC 2 / ISO 27001
          bridging letters under NDA. Email{" "}
          <a
            href="mailto:security@ratesassist.com.au?subject=Security%20report%20request"
            className="text-accent-700 underline hover:text-accent-800"
          >
            security@ratesassist.com.au
          </a>{" "}
          with your council, role, and the artefacts you need.
        </p>
      </section>

      <section
        id="disclosure"
        aria-labelledby="disclosure-heading"
        className="border-t border-ink-100 pt-8"
      >
        <h2
          id="disclosure-heading"
          className="text-xl font-semibold tracking-tight text-ink-900"
        >
          Coordinated vulnerability disclosure
        </h2>
        <p className="mt-3 text-ink-700">
          RatesAssist operates a coordinated disclosure programme. Security
          researchers and council ICT teams who identify a vulnerability
          should report it to{" "}
          <a
            href="mailto:security@ratesassist.com.au?subject=Vulnerability%20disclosure"
            className="text-accent-600 underline hover:text-accent-700"
          >
            security@ratesassist.com.au
          </a>
          . We acknowledge reports within two Australian business days,
          confirm triage outcomes within ten business days, and credit
          reporters in the changelog where they have consented. We do not
          pursue legal action against good-faith researchers acting under
          this policy.
        </p>
      </section>
    </TrustPageShell>
  );
}
