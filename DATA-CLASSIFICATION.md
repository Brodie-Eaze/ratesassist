# RatesAssist data classification

Authoritative per-field classification for every persisted entity in
`@ratesassist/db`. Aligned to the Australian Government PSPF-derived
information-security classifications used by state local-government data
custodians:

| Tier | Definition (operational) |
| --- | --- |
| **PUBLIC** | Already published or trivially derivable from public registers. No confidentiality controls required beyond integrity. |
| **OFFICIAL** | Routine business information. Disclosure unlikely to cause harm but is not authorised outside the council and its processors. |
| **OFFICIAL:Sensitive** | Personal information, financial detail, or other content whose disclosure could cause limited harm to an individual or the council. Encryption-at-rest mandatory; access logged. |
| **PROTECTED** | Concentrated PII, secrets, or audit material whose disclosure could enable widespread harm. Encryption-at-rest with a customer-managed KMS CMK; restricted access roles; tamper-evident audit. |

Implications by tier are summarised at the end of this document.

---

## Tenants (councils)

| Field | Class | Notes |
| --- | --- | --- |
| id | OFFICIAL | Internal UUID. |
| code | PUBLIC | Council short code. |
| name | PUBLIC | Registered LGA name. |
| state | PUBLIC |  |
| centerLat / centerLng | PUBLIC | Council seat. |
| population | PUBLIC | ABS census. |
| rateableProperties | PUBLIC | LGA annual report. |
| rateRevenue | PUBLIC | LGA annual financial statements. |
| createdAt / deletedAt | OFFICIAL | Internal lifecycle. |

## Properties

| Field | Class | Notes |
| --- | --- | --- |
| id | OFFICIAL | Internal UUID. |
| tenantId | OFFICIAL | Foreign key. |
| assessmentNumber | OFFICIAL | Council primary key; not generally public but appears on rates notices. |
| address | OFFICIAL | Street address of a rateable parcel. |
| suburb | PUBLIC |  |
| postcode | PUBLIC |  |
| state | PUBLIC |  |
| landUse | PUBLIC | Often published in valuation rolls. |
| valuation | OFFICIAL | Public in some jurisdictions, not all; treat as OFFICIAL. |
| annualRates | OFFICIAL |  |
| balance | OFFICIAL:Sensitive | Per-account financial position. |
| lastPaymentDate / lastPaymentAmount | OFFICIAL:Sensitive | Reveals payment behaviour. |
| paymentMethod | OFFICIAL:Sensitive | Hints at banking relationship. |
| pensionerRebate | OFFICIAL:Sensitive | Health/age inference. |
| paymentArrangement | OFFICIAL:Sensitive | Financial-hardship inference. |
| notes | OFFICIAL:Sensitive | Free-text; may contain PII or hardship detail. |
| centroidLat / centroidLng | PUBLIC | Cadastre. |
| parcel (geometry) | PUBLIC | Cadastre. |
| createdAt / updatedAt / deletedAt | OFFICIAL |  |

## Owners

| Field | Class | Notes |
| --- | --- | --- |
| id | OFFICIAL | Internal UUID. |
| tenantId | OFFICIAL | FK. |
| ownerExtId | OFFICIAL | Council-side ID. |
| name | PUBLIC | Companies are public via ASIC; individuals appear on the public valuation roll in most states. |
| abn | OFFICIAL:Sensitive | ABN itself is public, but its association with a specific rate account is not. |
| abnStatus / abnCheckedAt | OFFICIAL | Derived from ABN Lookup. |
| postalAddress | OFFICIAL | Service address; may differ from property. |
| email | OFFICIAL:Sensitive | Direct contact. |
| phone | OFFICIAL:Sensitive | Direct contact. |
| ownerSince | OFFICIAL | From land-titles register. |
| previousOwners | OFFICIAL | Land-titles register; eventually public. |
| createdAt / deletedAt | OFFICIAL |  |

## Property↔Owner join

| Field | Class | Notes |
| --- | --- | --- |
| propertyId | OFFICIAL |  |
| ownerId | OFFICIAL |  |
| position | OFFICIAL | Co-owner ordering. |

## Tenements (mining registers)

All fields PUBLIC — sourced from the state mining-titles register (DMIRS in
WA, Resources in QLD/NSW). Listed for completeness:

| Field | Class | Notes |
| --- | --- | --- |
| id / tenementId | PUBLIC | Public register key. |
| type / status | PUBLIC |  |
| holder / holderAbn | PUBLIC | Register-published. |
| commodity | PUBLIC |  |
| grantedDate / expiryDate | PUBLIC |  |
| areaHectares | PUBLIC |  |
| intersectsAssessmentNumbers | OFFICIAL | Derived correlation; not in any public register. |
| isProducing | PUBLIC | Reportable. |
| lastWorkProgramYear | PUBLIC |  |
| polygon | PUBLIC | WFS GetFeature output. |

## Tenement↔Property join

| Field | Class | Notes |
| --- | --- | --- |
| tenementId | PUBLIC |  |
| propertyId | OFFICIAL | Linkage to a council assessment. |

## Transactions

| Field | Class | Notes |
| --- | --- | --- |
| id | OFFICIAL |  |
| tenantId / propertyId | OFFICIAL |  |
| date | OFFICIAL |  |
| type | OFFICIAL |  |
| amount | OFFICIAL:Sensitive | Per-account financial detail. |
| reference | OFFICIAL:Sensitive | May contain bank refs. |
| runningBalance | OFFICIAL:Sensitive |  |

## Signal hits

| Field | Class | Notes |
| --- | --- | --- |
| id | OFFICIAL |  |
| tenantId / propertyId | OFFICIAL |  |
| signalId | PUBLIC | Catalogue identifier. |
| weight | PUBLIC |  |
| evidence | OFFICIAL | Free text; may quote OFFICIAL:Sensitive material. |
| firedAt | OFFICIAL |  |

## Mismatch candidates

| Field | Class | Notes |
| --- | --- | --- |
| id / tenantId / propertyId | OFFICIAL |  |
| kind / severity / reason | OFFICIAL |  |
| estAnnualRatesNew / estUplift / estArrears3y | OFFICIAL:Sensitive | Speculative financial projections about a specific account. |
| compositeScore | OFFICIAL |  |
| signalsJson | OFFICIAL |  |
| createdAt | OFFICIAL |  |

## Audit log

| Field | Class | Notes |
| --- | --- | --- |
| id | OFFICIAL |  |
| tenantId | OFFICIAL |  |
| actorId / actorKind | OFFICIAL | Internal user/service identity. |
| action / targetType / targetId | OFFICIAL |  |
| **before / after** | **PROTECTED** | May embed any field from any table above, including OFFICIAL:Sensitive content. Treated at the highest applicable tier. |
| correlationId | OFFICIAL |  |
| ip | OFFICIAL:Sensitive | Personal data under the Privacy Act. |
| userAgent | OFFICIAL |  |
| occurredAt | OFFICIAL |  |

## Commit tokens

| Field | Class | Notes |
| --- | --- | --- |
| id | OFFICIAL |  |
| tenantId | OFFICIAL |  |
| scope | OFFICIAL |  |
| **payloadHash** | **PROTECTED** | Bearer-equivalent if leaked alongside the original payload. |
| expiresAt / consumedAt / createdAt | OFFICIAL |  |

## API keys

| Field | Class | Notes |
| --- | --- | --- |
| id | OFFICIAL |  |
| tenantId | OFFICIAL |  |
| label | OFFICIAL |  |
| **hash** | **PROTECTED** | Argon2 hash; treat as a password verifier. Never log; never return in API responses. |
| scopes | OFFICIAL |  |
| createdAt / revokedAt | OFFICIAL |  |

## Users (Phase 3 stub)

| Field | Class | Notes |
| --- | --- | --- |
| id | OFFICIAL |  |
| tenantId | OFFICIAL |  |
| email | OFFICIAL:Sensitive | Personal data. |
| displayName | OFFICIAL |  |
| role | OFFICIAL |  |
| createdAt / disabledAt | OFFICIAL |  |

## Sessions (Phase 3 stub)

| Field | Class | Notes |
| --- | --- | --- |
| id | OFFICIAL |  |
| userId | OFFICIAL |  |
| **tokenHash** | **PROTECTED** | Bearer-equivalent. |
| createdAt / expiresAt / revokedAt | OFFICIAL |  |

---

## Tier implications

### PUBLIC
- No encryption-at-rest requirement beyond cluster-default.
- May appear in marketing material, screenshots, demos.

### OFFICIAL
- Encryption-at-rest at the storage volume (RDS storage encryption with a
  customer-managed KMS CMK in `ap-southeast-2`).
- TLS 1.3 in transit.
- Role-based access via `app_user`; tenant isolation via Postgres RLS keyed
  off the `app.tenant_id` GUC.

### OFFICIAL:Sensitive
- Everything in OFFICIAL, plus:
- Column-level encryption via `pgcrypto` envelope (`pgp_sym_encrypt`) keyed
  by a per-tenant data key, itself wrapped by the cluster KMS CMK. Phase 3.
- All reads logged to `audit_log`.
- 7-year retention per state records legislation; deletion requires the
  audit-retention exception process.

### PROTECTED
- Everything in OFFICIAL:Sensitive, plus:
- Stored in a dedicated tablespace on encrypted volumes with TDE.
- Read access requires explicit role grant, not the default `app_user`.
- For `audit_log`: `UPDATE` and `DELETE` are revoked at the SQL level so the
  log is append-only by construction. Backups go to a write-once S3 bucket
  with object-lock enabled.
- For `payloadHash` / `hash` / `tokenHash`: never logged, never returned to
  clients, only ever compared via constant-time hash verification.

### Deployment posture
- **Region**: AWS `ap-southeast-2` (Sydney). No cross-region replication of
  OFFICIAL:Sensitive or PROTECTED data.
- **Backup**: 35-day PITR; weekly logical dump to object-locked S3.
- **Key management**: AWS KMS CMK per environment; rotation annually;
  separate CMKs for storage and column-level encryption.
- **Network**: private VPC; no public Postgres endpoint.
