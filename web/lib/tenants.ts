// Multi-tenant + adapter architecture model.
//
// Each council = one tenant. A tenant has:
//   - core registration (state, ABN, jurisdiction)
//   - one rating-system adapter (TechOne / Civica / OpenOffice / etc.)
//   - zero-or-more auxiliary adapters (Nearmap, Twilio, EDRMS, ...)
//   - sync state per adapter
//   - per-tenant config (rate categories, certificate templates, brand)
//   - audit-log partition + immutable append-only event stream
//
// Cross-council intelligence emerges only when ≥5 tenants opt in
// (k-anonymity threshold) — anonymised aggregates only, no raw records ever
// shared across tenants.

import { COUNCILS } from "./data";
import type { Council } from "./types";

export type AdapterStatus = "live" | "degraded" | "configuring" | "unconfigured" | "error";

export type RatingPlatform =
  | "TechOne CiAnywhere"
  | "Civica Authority"
  | "Civica Pathway"
  | "Open Office"
  | "MagiQ"
  | "PCA"
  | "CSV Export";

export type RatingAdapter = {
  platform: RatingPlatform;
  vendor: string;
  authType: "OAuth 2.0" | "API key" | "SFTP" | "DB read-only" | "CSV upload";
  endpoint?: string;
  status: AdapterStatus;
  capabilities: ("read.property" | "read.owner" | "read.transactions" | "write.owner_contact" | "write.note" | "write.note_attachment")[];
  lastSync: string;
  recordsMirrored: number;
  syncCadence: string;
};

export type AuxiliaryAdapter = {
  id: string;
  name: string;
  category: "Imagery" | "Communications" | "Documents" | "Identity" | "Payments";
  status: AdapterStatus;
  enabled: boolean;
};

export type TenantRegistration = {
  council: Council;
  legalName: string;
  abn: string;
  contractStart: string;
  contractType: "Pilot" | "Standard" | "Enterprise";
  isolation: "logical-rls" | "physical-vpc";
  benchmarkOptIn: boolean;
  rating: RatingAdapter;
  auxiliary: AuxiliaryAdapter[];
  metrics: {
    parcelsMirrored: number;
    officersActive: number;
    candidatesOpen: number;
    upliftPipelineAud: number;
    auditEvents30d: number;
  };
};

// Build tenant registry from the council seed data + plug-in adapter mocks
export function listTenants(): TenantRegistration[] {
  return COUNCILS.map((council, idx): TenantRegistration => {
    // Distribute platforms realistically: most WA → TechOne, NSW → Civica, etc.
    const platform: RatingPlatform =
      council.state === "NSW"
        ? "Civica Authority"
        : council.state === "QLD"
          ? "TechOne CiAnywhere"
          : "TechOne CiAnywhere";

    const ratingStatus: AdapterStatus =
      idx === 2 ? "configuring" : idx === 5 ? "degraded" : "live";

    return {
      council,
      legalName: `${council.name} (incorporated)`,
      abn: `${20 + idx * 3} ${100 + idx * 17} ${200 + idx * 11} ${300 + idx * 5}`.replace(
        /\d+/g,
        (m) => m.slice(0, 3),
      ),
      contractStart: `2025-${String(((idx * 2) % 11) + 1).padStart(2, "0")}-15`,
      contractType: idx === 0 ? "Pilot" : idx < 5 ? "Standard" : "Enterprise",
      isolation: idx > 5 ? "physical-vpc" : "logical-rls",
      benchmarkOptIn: idx !== 2 && idx !== 5,
      rating: {
        platform,
        vendor: platform.startsWith("TechOne") ? "TechnologyOne" : "Civica",
        authType: ratingStatus === "configuring" ? "CSV upload" : "OAuth 2.0",
        endpoint:
          ratingStatus !== "configuring"
            ? `https://${council.code.toLowerCase()}.${platform.startsWith("TechOne") ? "cia.technologyone.com" : "civica.com.au"}/api/v2`
            : undefined,
        status: ratingStatus,
        capabilities:
          ratingStatus === "live"
            ? [
                "read.property",
                "read.owner",
                "read.transactions",
                "write.owner_contact",
                "write.note",
              ]
            : ratingStatus === "degraded"
              ? ["read.property", "read.owner"]
              : [],
        lastSync:
          ratingStatus === "live"
            ? `${5 + (idx * 2) % 25}m ago`
            : ratingStatus === "degraded"
              ? `${1 + (idx % 4)}h ago`
              : "never",
        recordsMirrored:
          ratingStatus === "live" || ratingStatus === "degraded"
            ? council.rateableProperties
            : 0,
        syncCadence: ratingStatus === "live" ? "every 15 min" : ratingStatus === "degraded" ? "hourly" : "—",
      },
      auxiliary: [
        {
          id: "nearmap",
          name: "Nearmap AI",
          category: "Imagery",
          status: idx % 3 === 0 ? "live" : idx % 3 === 1 ? "configuring" : "unconfigured",
          enabled: idx % 3 === 0,
        },
        {
          id: "twilio",
          name: "Twilio (SMS+Voice)",
          category: "Communications",
          status: "live",
          enabled: true,
        },
        {
          id: "sendgrid",
          name: "SendGrid",
          category: "Communications",
          status: "live",
          enabled: true,
        },
        {
          id: "docusign",
          name: "DocuSign",
          category: "Documents",
          status: idx > 3 ? "live" : "unconfigured",
          enabled: idx > 3,
        },
        {
          id: "edrms-cm",
          name: "Council EDRMS — Content Manager",
          category: "Documents",
          status: idx > 4 ? "live" : "unconfigured",
          enabled: idx > 4,
        },
        {
          id: "stripe",
          name: "Stripe (citizen payments)",
          category: "Payments",
          status: idx % 2 === 0 ? "live" : "unconfigured",
          enabled: idx % 2 === 0,
        },
      ],
      metrics: {
        parcelsMirrored:
          ratingStatus === "configuring" ? 0 : council.rateableProperties,
        officersActive: 2 + (idx % 4) * 3,
        candidatesOpen: 4 + (idx % 5) * 2,
        upliftPipelineAud: Math.round(council.rateRevenue * (0.002 + (idx % 4) * 0.0008)),
        auditEvents30d: 4_200 + idx * 1_800,
      },
    };
  });
}

// ===== Cross-council intelligence (anonymised, k-anonymous) =====
//
// Only computed across opted-in tenants where peer group ≥ 5.

export function crossCouncilBenchmarks(): {
  metric: string;
  description: string;
  unit: string;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  yourCouncilValue?: number;
  yourCouncilPercentile?: number;
}[] {
  const tenants = listTenants().filter((t) => t.benchmarkOptIn);
  if (tenants.length < 5) {
    // k-anonymity not satisfied
    return [];
  }
  return [
    {
      metric: "Collection rate",
      description: "Annual rates collected ÷ levied",
      unit: "%",
      p25: 91.2,
      p50: 93.4,
      p75: 95.1,
      p90: 96.8,
      yourCouncilValue: 94.3,
      yourCouncilPercentile: 0.62,
    },
    {
      metric: "Days sales outstanding",
      description: "Average debtor age",
      unit: "days",
      p25: 18.4,
      p50: 24.1,
      p75: 31.7,
      p90: 42.3,
      yourCouncilValue: 22.8,
      yourCouncilPercentile: 0.42,
    },
    {
      metric: "Mining-mismatch density",
      description: "Recovery candidates per 1,000 rateable parcels",
      unit: "/ 1,000 parcels",
      p25: 0.7,
      p50: 1.4,
      p75: 2.9,
      p90: 5.2,
      yourCouncilValue: 4.1,
      yourCouncilPercentile: 0.84,
    },
    {
      metric: "Time-to-candidate",
      description: "Avg time from anomaly detection to officer review",
      unit: "minutes",
      p25: 28,
      p50: 42,
      p75: 64,
      p90: 96,
      yourCouncilValue: 47,
      yourCouncilPercentile: 0.53,
    },
    {
      metric: "Reclassification success rate",
      description: "% of high-confidence candidates progressed and collected",
      unit: "%",
      p25: 58,
      p50: 67,
      p75: 76,
      p90: 84,
      yourCouncilValue: 71,
      yourCouncilPercentile: 0.61,
    },
    {
      metric: "Officer enquiry handling time",
      description: "Avg seconds per phone/counter enquiry",
      unit: "seconds",
      p25: 195,
      p50: 268,
      p75: 360,
      p90: 480,
      yourCouncilValue: 215,
      yourCouncilPercentile: 0.30,
    },
    {
      metric: "Pensioner rebate uptake",
      description: "% of eligible ratepayers claiming",
      unit: "%",
      p25: 78,
      p50: 85,
      p75: 91,
      p90: 95,
      yourCouncilValue: 88,
      yourCouncilPercentile: 0.62,
    },
  ];
}

// Plug-in adapter catalogue — supported integrations
export const ADAPTER_CATALOGUE: Array<{
  id: string;
  name: string;
  category: "Rating system" | "Imagery" | "Communications" | "Documents" | "Identity" | "Payments" | "Spatial" | "Compliance";
  vendor: string;
  authTypes: string[];
  description: string;
  state: "Generally Available" | "Beta" | "Roadmap";
}> = [
  { id: "techone", name: "TechnologyOne CiAnywhere", category: "Rating system", vendor: "TechnologyOne", authTypes: ["OAuth 2.0", "API key"], description: "Property & Rating module — read + scoped write via approval.", state: "Generally Available" },
  { id: "civica-authority", name: "Civica Authority", category: "Rating system", vendor: "Civica", authTypes: ["API key", "SFTP"], description: "NSW councils on Civica Authority REST API (formerly Pathway).", state: "Generally Available" },
  { id: "civica-pathway", name: "Civica Pathway (legacy)", category: "Rating system", vendor: "Civica", authTypes: ["SFTP", "CSV upload"], description: "Legacy Pathway customers via nightly CSV exchange.", state: "Beta" },
  { id: "openoffice", name: "Open Office (Civica)", category: "Rating system", vendor: "Civica", authTypes: ["DB read-only"], description: "On-premise Open Office databases via secure read-only replica.", state: "Beta" },
  { id: "magiq", name: "MagiQ", category: "Rating system", vendor: "MagiQ", authTypes: ["CSV upload"], description: "Smaller council platform via scheduled CSV uploads.", state: "Roadmap" },
  { id: "csv", name: "CSV Export Bridge", category: "Rating system", vendor: "Self-managed", authTypes: ["SFTP", "CSV upload"], description: "Universal fallback when no live API is available.", state: "Generally Available" },
  { id: "nearmap", name: "Nearmap AI", category: "Imagery", vendor: "Nearmap", authTypes: ["API key"], description: "High-resolution aerial imagery + AI change-detection feed.", state: "Generally Available" },
  { id: "metromap", name: "Metromap", category: "Imagery", vendor: "Metromap", authTypes: ["API key"], description: "Australian aerial imagery alternative provider.", state: "Beta" },
  { id: "geoscape", name: "Geoscape Buildings + Surfaces", category: "Imagery", vendor: "Geoscape Australia", authTypes: ["API key"], description: "Derived national buildings dataset for change-detection cross-checks.", state: "Generally Available" },
  { id: "dmirs", name: "DMIRS / state mining registers", category: "Spatial", vendor: "WA DMIRS + state equivalents", authTypes: ["Public WFS"], description: "Live mining tenement boundaries by state.", state: "Generally Available" },
  { id: "landgate", name: "Landgate / state cadastre", category: "Spatial", vendor: "Landgate + state agencies", authTypes: ["Public WFS"], description: "Authoritative cadastral parcel boundaries.", state: "Generally Available" },
  { id: "abn", name: "ATO ABN Lookup", category: "Identity", vendor: "ATO", authTypes: ["API key (free)"], description: "ABN status, entity type, GST registration.", state: "Generally Available" },
  { id: "asic", name: "ASIC Connect", category: "Identity", vendor: "ASIC", authTypes: ["API key"], description: "Company registration, director changes.", state: "Generally Available" },
  { id: "entra", name: "Microsoft Entra SSO", category: "Identity", vendor: "Microsoft", authTypes: ["OIDC + SCIM"], description: "Council staff SSO + provisioning.", state: "Generally Available" },
  { id: "twilio", name: "Twilio", category: "Communications", vendor: "Twilio", authTypes: ["API key"], description: "SMS + voice transactional comms.", state: "Generally Available" },
  { id: "messagemedia", name: "MessageMedia", category: "Communications", vendor: "Sinch (AU-domiciled)", authTypes: ["API key"], description: "AU-based SMS provider.", state: "Generally Available" },
  { id: "sendgrid", name: "SendGrid", category: "Communications", vendor: "Twilio", authTypes: ["API key"], description: "Transactional email.", state: "Generally Available" },
  { id: "council-m365", name: "Council Microsoft 365 Exchange", category: "Communications", vendor: "Microsoft", authTypes: ["OAuth 2.0"], description: "Send via the council's own M365 tenant.", state: "Generally Available" },
  { id: "edrms-contentmanager", name: "Content Manager (Micro Focus)", category: "Documents", vendor: "Micro Focus", authTypes: ["API key"], description: "Council records management write-back.", state: "Beta" },
  { id: "edrms-objective", name: "Objective EDRMS", category: "Documents", vendor: "Objective Corporation", authTypes: ["API key"], description: "Alternative EDRMS for write-back.", state: "Roadmap" },
  { id: "docusign", name: "DocuSign", category: "Documents", vendor: "DocuSign", authTypes: ["OAuth 2.0"], description: "Payment arrangements + rebate forms e-signature.", state: "Generally Available" },
  { id: "bpay", name: "BPAY (view)", category: "Payments", vendor: "BPAY", authTypes: ["API key"], description: "Reference resolution from BPAY biller code.", state: "Generally Available" },
  { id: "stripe", name: "Stripe", category: "Payments", vendor: "Stripe", authTypes: ["API key"], description: "Citizen-side payment intents.", state: "Generally Available" },
];
