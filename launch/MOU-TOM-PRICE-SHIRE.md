# Memorandum of Understanding

**Rates Audit and Recovery Pilot**

| | |
|---|---|
| **Document** | Pilot Memorandum of Understanding (MoU) |
| **Parties** | Shire of Ashburton (Tom Price) and RatesAssist Pty Ltd |
| **Status** | Draft — for council legal and Privacy Officer review |
| **Version** | 1.0 |
| **Effective date** | _[To be inserted on execution]_ |
| **Term** | 60 days from the Effective Date |
| **Governing law** | Western Australia |
| **Owner (RatesAssist)** | Brodie · `brodie@amalafinance.com.au` |

---

## 1. Parties

This Memorandum of Understanding ("**MoU**") is entered into between:

1. **Shire of Ashburton** ABN _[council to insert]_, a local government constituted under the *Local Government Act 1995 (WA)*, of Poinciana Street, Tom Price WA 6751 (the "**Council**"); and

2. **RatesAssist Pty Ltd** ACN _[insert on incorporation]_, of _[registered office]_, Australia ("**RatesAssist**" or the "**Operator**").

Each a "**Party**" and together the "**Parties**".

---

## 2. Background

A. The Council is responsible for the assessment, levying and recovery of rates over land within the Shire of Ashburton pursuant to Part 6, Division 6 of the *Local Government Act 1995 (WA)*.

B. RatesAssist operates a rates audit and recovery decision-support platform that cross-references public registers (DMIRS, Landgate / SLIP, ABR, EMITS, Commonwealth and state grant feeds) against council-supplied rating data to surface candidate recoveries and produce council-grade evidence packs.

C. The Parties wish to conduct a time-limited pilot to evaluate the platform's fit for the Council's recovery audit workflow under the terms set out in this MoU.

---

## 3. Pilot scope

### 3.1 Geographic and tenancy scope

The pilot is limited to **one local government area** — the Shire of Ashburton, with operations conducted from Tom Price. RatesAssist will provision a single Council tenant. No other council tenant will share infrastructure, audit logs or evidence with the Council tenant.

### 3.2 Functional scope

The pilot is a **recovery audit only**. RatesAssist will:

(a) ingest a rating-roll snapshot supplied by the Council under §6;

(b) join it against public registers;

(c) surface candidate recoveries via the operator console with full evidence trails; and

(d) generate evidence packs for review by Council officers.

### 3.3 No production rate mutations

RatesAssist will **not** initiate or execute any change to the Council's production rating system during the pilot. Every outbound action — rate-notice reissue, owner-contact update, recovery referral, write-off, or any other rates-impacting decision — is taken by the Council under its own statutory authority and only after written approval by a Council supervisor of grade _[Manager Rates or above]_.

### 3.4 Term

The pilot runs for **60 days** from the Effective Date, unless extended in writing by both Parties or terminated under §10.

---

## 4. Success fee

### 4.1 Fee model

In consideration for the pilot, the Council agrees to pay RatesAssist a success fee of **twelve per cent (12%)** of **Recovered Rates** (defined in §4.2) attributable to candidates surfaced through the RatesAssist platform during the Term, payable over **24 months** from the date the Council confirms each recovery in writing.

### 4.2 Definitions

"**Recovered Rates**" means amounts actually received by the Council into its consolidated rates account in respect of a Recovery Candidate, net of any refunds, write-offs or successful objections, and net of GST.

"**Recovery Candidate**" means a candidate surfaced through the RatesAssist platform, confirmed by the Council's finance team as a legitimate recovery opportunity, and entered onto the Council's rates ledger as a recoverable amount.

### 4.3 Per-candidate cap

The success fee payable on any single Recovery Candidate is capped at **AUD $250,000** regardless of the total Recovered Rates attributable to that candidate.

### 4.4 Payment terms

(a) The Council will report Recovered Rates to RatesAssist **quarterly in arrears** on the last business day of each calendar quarter.

(b) RatesAssist will invoice the Council within ten (10) business days of receiving each quarterly report.

(c) The Council will pay each invoice within **thirty (30) days** of receipt.

(d) All amounts are in Australian dollars and exclusive of GST. GST will be added where applicable and a tax invoice issued.

### 4.5 No other fees

RatesAssist will not charge the Council any setup, licence, per-seat, per-property, infrastructure or professional-services fee during the Term. The success fee is the sole consideration.

### 4.6 Disputed amounts

If the Council disputes any amount on an invoice, the undisputed portion is payable on the original due date and the Parties will negotiate the disputed portion in good faith.

---

## 5. Data handling

### 5.1 APP compliance

RatesAssist will at all times comply with the *Privacy Act 1988 (Cth)* and the Australian Privacy Principles (APPs), and with the Council's Information Privacy Policy adopted under the *Local Government Act 1995 (WA)*. The Privacy Impact Assessment (`PRIVACY-IMPACT-ASSESSMENT.md`) and the Sub-Processor list (`SUB-PROCESSORS.md`) form part of this MoU by reference.

### 5.2 Data residency — Australian region pinning

(a) All Council-supplied personal information processed by RatesAssist will be hosted in an **Australian region** of the Operator's cloud infrastructure provider (the "**AU Region**"). For the Term, this means Railway's `asia-southeast1` is not acceptable; RatesAssist will pin Railway hosting to an Australian region before any Council-supplied data is loaded.

(b) Cross-border disclosure to Anthropic, PBC (United States) for LLM inference is acknowledged by the Council as disclosed in §6 of the PIA and is subject to the controls described there.

### 5.3 Audit logs

RatesAssist will retain an immutable, tamper-evident audit log of every read of and write to Council-supplied data for a period of **seven (7) years** consistent with the *State Records Act 2000 (WA)* and the Council's record-keeping plan. The Council may request a full audit-log export for its own records at any time during or after the Term.

### 5.4 Breach notification

RatesAssist will notify the Council's nominated Privacy Officer in writing within **seventy-two (72) hours** of becoming aware of any actual or reasonably suspected unauthorised access to, loss of, or disclosure of Council-supplied personal information. Notification will include the facts known at the time, the personal information involved, the steps RatesAssist has taken or proposes to take, and any other information required to enable the Council to assess its own obligations under the Notifiable Data Breaches scheme.

### 5.5 Return or deletion at end of Term

Within thirty (30) days of the end of the Term, RatesAssist will, at the Council's election, return all Council-supplied personal information to the Council and irreversibly delete its copies, or irreversibly delete all such information and provide a written certificate of deletion. Audit logs required to be retained under §5.3 are retained in tamper-evident form and access-controlled.

---

## 6. Operator obligations

RatesAssist will, at no cost to the Council:

(a) **Pin the AU Region** for Railway hosting prior to the Effective Date and provide the Council with written confirmation of the region.

(b) **Disable `RA_DEMO_AUTOLOGIN` in production** no later than the end of **week 1** of the Term. During week 1, the Council acknowledges the use of the dev-autologin escape hatch (see §7(c)) and accepts its compliance disclosure.

(c) **Publish a current sub-processor list** in `SUB-PROCESSORS.md` and notify the Council of any addition or change at least **thirty (30) days** before that sub-processor begins processing Council-supplied personal information.

(d) **Provide one named operator** (Brodie) as the single point of accountability for the Term, available during Australian Western Standard Time business hours.

(e) **Make no public reference** to the Council or to the pilot without the Council's prior written consent, except in regulatory filings or in response to a binding order.

(f) **Carry insurance** appropriate to the Term, including professional indemnity, cyber liability and public liability, and provide certificates of currency to the Council on request.

(g) **Provide a quarterly written report** to the Council on platform performance, candidates surfaced, candidates confirmed, and any incidents.

---

## 7. Council obligations

The Council will:

(a) **Provide a rating-roll snapshot** in a mutually agreed format (CSV or TechOne export) within five (5) business days of the Effective Date, refreshed monthly during the Term.

(b) **Designate two (2) SSO accounts** for nominated Council officers (Manager Rates, Senior Rates Officer or equivalent) for access to the operator console. The Council acknowledges that, until the Council's SSO is integrated, RatesAssist may at the Council's election operate the platform on the Council's behalf using credentials issued to RatesAssist.

(c) **Accept the demo-autologin disclosure for week 1** of the Term, during which RatesAssist may use a development autologin escape hatch to operate the platform on the Council's behalf while SSO is provisioned. The Council acknowledges that this is disclosed under the PIA and is removed from production by the end of week 1.

(d) **Confirm or reject each Recovery Candidate** within ten (10) business days of being surfaced.

(e) **Report Recovered Rates** quarterly under §4.4(a).

(f) **Update its privacy collection notice** to refer to "third-party decision-support providers, including RatesAssist" before the Effective Date, using the template wording provided by RatesAssist.

(g) **Pay invoices** under §4.4.

---

## 8. Intellectual property

8.1 **RatesAssist IP.** RatesAssist retains all right, title and interest in the RatesAssist platform, its source code, models, signal library, evidence-pack templates, documentation, and any improvements made during the Term. The Council receives a non-exclusive, non-transferable, royalty-free licence to use the platform for the Term and the duration of any subsequent commercial agreement.

8.2 **Council data.** The Council retains all right, title and interest in Council-supplied data. RatesAssist receives a limited licence to process Council-supplied data solely for the purposes of the pilot.

8.3 **No training.** RatesAssist will not use Council-supplied data to train any machine-learning model.

8.4 **Aggregated insights.** RatesAssist may publish aggregated, de-identified statistics derived from the pilot (for example, "Tier-2 WA councils recover an average of X% more rates with platform support") provided that no individual ratepayer, property, candidate or Council officer can be identified from the published statistic, and provided that the Council is not named without §6(e) consent.

---

## 9. Indemnity and limitation of liability

9.1 **Mutual indemnity.** Each Party indemnifies the other against losses arising from a breach of this MoU by the indemnifying Party, including a breach of §5 (Data handling).

9.2 **Cap.** Each Party's aggregate liability under or in connection with this MoU, whether in contract, tort (including negligence), under statute or otherwise, is capped at the total fees paid or payable under §4 during the twelve (12) months preceding the event giving rise to the liability.

9.3 **Excluded liability.** Neither Party is liable for indirect, consequential, special or punitive losses, lost profits, or loss of opportunity, except to the extent caused by wilful misconduct or by a breach of §5.

9.4 **Carve-outs.** The cap in §9.2 does not apply to: (i) a breach of confidentiality; (ii) a breach of §5 amounting to wilful misconduct; (iii) infringement of third-party intellectual property rights; or (iv) liability that cannot lawfully be limited.

---

## 10. Termination

10.1 **Termination for convenience.** Either Party may terminate this MoU on **fourteen (14) days' written notice**. Fees accrued before the termination date remain payable.

10.2 **Termination for cause.** Either Party may terminate this MoU immediately on written notice if the other Party:

(a) commits a material breach of this MoU and fails to remedy that breach within ten (10) business days of written notice; or

(b) becomes insolvent, enters administration, or has a controller appointed.

10.3 **Termination for unmitigated regulatory finding.** The Council may terminate immediately if the Council's Privacy Officer determines, on reasonable grounds, that continued processing under this MoU would put the Council in breach of the *Privacy Act 1988 (Cth)*, the APPs, or the Council's Information Privacy Policy, and the matter cannot be remedied within ten (10) business days.

10.4 **Effect of termination.** On termination, §5.5 (return or deletion) and §8 (IP) survive. Any accrued rights to fees under §4 survive until paid.

---

## 11. Confidentiality

Each Party will keep confidential the other Party's confidential information and use it only for the purposes of this MoU. This clause survives termination by five (5) years. It does not apply to information that is publicly available without breach, was lawfully known before disclosure, is lawfully obtained from a third party, or is required to be disclosed by law.

---

## 12. Variation

This MoU may be varied only by written agreement signed by both Parties. A variation may include, without limitation, an extension of the Term, an expansion of the functional scope, or the adoption of a different commercial model on conversion from pilot to ongoing engagement.

---

## 13. Notices

Notices must be in writing and sent to:

- **For the Council:** _[Manager Rates], Shire of Ashburton, Poinciana Street, Tom Price WA 6751._
- **For RatesAssist:** Brodie, `brodie@amalafinance.com.au`.

A notice sent by email is deemed received on the next business day after sending unless the sender receives a non-delivery notification.

---

## 14. Governing law and jurisdiction

This MoU is governed by the laws of **Western Australia**. The Parties submit to the non-exclusive jurisdiction of the courts of Western Australia and any courts of appeal from them.

---

## 15. Entire agreement

This MoU, including the documents incorporated by reference under §5.1, constitutes the entire agreement between the Parties in respect of its subject matter and supersedes any prior representations or agreements.

---

## 16. Counterparts and electronic execution

This MoU may be executed in counterparts and by electronic signature. Each counterpart is an original and together they form a single instrument.

---

## 17. Execution

**Executed as an agreement.**

**Signed for and on behalf of the Shire of Ashburton**

| Field | Detail |
|---|---|
| Name | _[CEO or delegate]_ |
| Position | _[Position]_ |
| Date | _____________________ |
| Signature | _____________________ |

**Witness**

| Field | Detail |
|---|---|
| Name | _____________________ |
| Position | _____________________ |
| Date | _____________________ |
| Signature | _____________________ |

**Signed for and on behalf of RatesAssist Pty Ltd**

| Field | Detail |
|---|---|
| Name | Brodie |
| Position | Director |
| Date | _____________________ |
| Signature | _____________________ |

**Witness**

| Field | Detail |
|---|---|
| Name | _____________________ |
| Position | _____________________ |
| Date | _____________________ |
| Signature | _____________________ |

---

*Document owner: Brodie · `brodie@amalafinance.com.au` · Version 1.0 · Last reviewed 2026-05-26.*
