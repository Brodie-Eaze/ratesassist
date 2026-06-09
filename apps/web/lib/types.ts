/**
 * `apps/web` type module.
 *
 * Domain types — `Property`, `Owner`, `Tenement`, `MismatchCandidate`,
 * `SignalDef`, `Council`, etc. — are owned by `@ratesassist/contract`. This
 * module re-exports them so existing `@/lib/types` imports continue to resolve,
 * and adds web-app-specific UI types (chat messages, integration cards, the
 * activity feed, bank deposits) that have not yet been promoted to the contract.
 *
 * No domain type is re-declared here. When a UI-specific type listed below
 * is needed by another package, promote it to `@ratesassist/contract` first.
 */

export type {
  // Geographic primitives
  LatLng,
  LngLat,
  BoundingBox,
  // Jurisdictions
  AustralianState,
  // Council / property / owner
  Council,
  LandUse,
  PaymentMethod,
  Property,
  AbnStatus,
  PreviousOwner,
  Owner,
  // Transactions
  TransactionType,
  Transaction,
  // Tenements
  TenementType,
  TenementStatus,
  Tenement,
  // Detection signals
  SignalCategory,
  SignalDef,
  SignalHit,
  MismatchSeverity,
  MismatchCandidate,
  // Communications drafting
  CommunicationTone,
  ReminderDraft,
  // Audit log
  AuditEventCategory,
  AuditEvent,
  // Adapter metadata
  AdapterCapability,
  AdapterIdentity,
} from "@ratesassist/contract";

// ===== Web-app-only types =====
//
// These remain local until the contract grows surfaces for them. Each one is
// a UI concern (chat transcripts, integration cards, activity feed, payment
// reconciliation) that no adapter has needed to model yet.

/** Chat message role. UI-only — the LLM transcript is a client concept. */
export type ChatRole = "user" | "assistant";

/**
 * Tool call as captured for display in the chat transcript.
 *
 * Mirrors the shape returned by the chat orchestrator and rendered by the
 * chat UI; not part of the adapter contract.
 */
export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
};

/** A single message in the chat transcript displayed by the web UI. */
export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  timestamp: string;
};

// ----- Connections / integrations (UI cards on /connections page) -----

export type IntegrationStatus = "live" | "stub" | "planned" | "degraded" | "unconfigured" | "error";

export type Integration = {
  id: string;
  name: string;
  category:
    | "Rating system"
    | "Mining & cadastral"
    | "Imagery"
    | "Identity"
    | "Communications"
    | "Payments"
    | "Documents"
    | "Observability";
  description: string;
  status: IntegrationStatus;
  lastSync?: string;
  authType: "OAuth 2.0" | "API key" | "Public" | "SSO" | "Webhook" | "SMTP/SMS gateway";
  scope?: string;
  endpoint?: string;
  vendor?: string;
};

// ----- Activity feed (UI cards on /activity page) -----

export type ActivityEvent = {
  id: string;
  ts: string;
  user: string;
  council: string;
  action: string;
  target?: string;
  detail: string;
  category: "lookup" | "write" | "comms" | "recovery" | "system" | "auth";
};

// ----- Reconciliation (bank deposits view) -----

export type BankDeposit = {
  id: string;
  date: string;
  amount: number;
  reference: string;
  source: string;
  matchAssessment?: string;
  matchConfidence?: number;
  status: "matched" | "suggested" | "unmatched";
};
