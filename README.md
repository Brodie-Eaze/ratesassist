<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║                          R A T E S A S S I S T                    ║
  ║       Vertical AI for Australian local government rates           ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

# RatesAssist

> **Vertical AI software for Australian council rates departments.**
> Productivity. Recovery. Intelligence. Citizen self-service.

| | |
|---|---|
| **Status** | Pre-pilot |
| **Working name** | RatesAssist (see [`internal/BRAND-CANDIDATES.md`](internal/BRAND-CANDIDATES.md)) |
| **Stack** | TypeScript, MCP, Anthropic Claude, AWS Sydney |
| **Confidentiality** | Confidential — see individual document headers |

---

## What is in this repository

This repository holds the foundational specification, supporting documents, and a working MCP-server prototype for **RatesAssist** — a vertical AI product targeting Australian council rates departments.

The product is anchored on a domain co-founder currently running rates departments for multiple councils, manually identifying $30–50M annually in mis-classified rates. RatesAssist productises that capability and extends it across the broader Australian council market (537 LGAs).

## Repository structure

| Path | Contents |
|---|---|
| [`apps/`](apps/) | Application workspaces (web app, MCP server, etc.). |
| [`packages/`](packages/) | Shared TypeScript packages (adapters, contracts, identity, recovery engine, spatial). |
| [`internal/`](internal/) | Strategic and operational artefacts — pitch, brand, entity structure, founder discovery, partner outreach drafts. Not part of the technical product. |

## Read in this order

If you've never seen this project before, work through these documents in sequence:

1. **[`RatesAssist.md`](RatesAssist.md)** — master specification. Read this first. Everything else extends from it.
2. **[`PRODUCTION-PLAN.md`](PRODUCTION-PLAN.md)** — canonical technical plan.
3. **[`SECURITY.md`](SECURITY.md)** — externally-shareable security posture.
4. **[`PRIVACY.md`](PRIVACY.md)** — externally-shareable privacy posture.
5. **[`internal/`](internal/)** — strategic context (pilot pitch, runbook, entity options, brand, discovery, outreach).

## Repository layout

```
rates-assist/
├── README.md                    ← you are here
├── RatesAssist.md               ← master specification
├── SECURITY.md                  ← security posture (external)
├── PRIVACY.md                   ← privacy posture (external)
├── PRODUCTION-PLAN.md           ← canonical technical plan
├── apps/                        ← application workspaces
├── packages/                    ← shared TypeScript packages
├── internal/                    ← strategic + operational artefacts
│   ├── PILOT-PITCH.md
│   ├── PILOT-RUNBOOK.md
│   ├── ENTITY-OPTIONS.md
│   ├── BRAND-CANDIDATES.md
│   ├── MUM-DISCOVERY.md
│   ├── OVERNIGHT-REPORT.md
│   └── outreach/
├── package.json                 ← prototype Node project
├── tsconfig.json
├── src/
│   ├── index.ts                 ← MCP server entry point
│   ├── mock-data.ts             ← mock TechOne-style data
│   └── wa-tenements.ts          ← mock WA mining tenement data
└── build/                       ← compiled output
```

## Running the prototype MCP

The prototype is a working Model Context Protocol server with mocked TechOne and DMIRS-style data. It demonstrates the architecture and lets you experience the end-user feel before any real integrations are wired.

```bash
npm install
npm run build
```

This produces `build/index.js`, an executable Node script speaking MCP over stdio.

### Wiring into Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rates-assist": {
      "command": "node",
      "args": ["/Users/Brodie/RatesAssist/build/index.js"]
    }
  }
}
```

Restart Claude Desktop. Then ask things like:

- *"Give me today's rates briefing"*
- *"Find Smiths in Mortdale"*
- *"Pull up 12 Boundary Road"*
- *"Draft a friendly reminder for that property"*
- *"Find all properties with mining tenements"* *(after the WA tenement tools are built)*
- *"Generate an evidence pack for assessment WA-1102-44"*

### Smoke test (no Claude Desktop required)

```bash
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"daily_briefing","arguments":{}}}'
  sleep 0.5
} | node build/index.js
```

You should see JSON-RPC responses for each request.

### Or use MCP Inspector

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

Opens a browser-based UI to interact with the server.

## What's mocked vs what's real

The prototype is intentionally entirely mocked. No real council data is touched. This is a deliberate design choice for the validation phase — see `PILOT-RUNBOOK.md` for the production data path.

| Layer | Prototype | Production plan |
|---|---|---|
| Property / owner data | Hardcoded mock | TechOne CiAnywhere REST API (or Civica equivalent) |
| Mining tenement data | Hardcoded mock (WA-style) | DMIRS WFS / GeoVIEW.WA daily ingest |
| Cadastral data | Not yet | Landgate SLIP / state spatial services |
| Aerial imagery | Not yet | Nearmap / Metromap APIs |
| Read tools | In-memory filter | API GET endpoints with audit logging |
| Write tools | Preview-only mock | API PATCH/POST with confirmation + audit |
| Auth | None | Microsoft Entra SSO + role-based permissions |
| Multi-tenant | Single tenant | Tenant-isolated RLS + per-council credential vaulting |
| Hosting | Local stdio | AWS Sydney with Anthropic AU region |

## Tools currently exposed by the prototype

**Read tools:**
- `search_property` — by address, suburb, or assessment number
- `search_by_owner` — by owner name with optional suburb filter
- `get_property_detail` — full record with owners, valuation, balance, notes
- `get_transaction_history` — levies, payments, adjustments, interest
- `list_overdue` — properties with outstanding balance

**Write tools (preview-only):**
- `draft_payment_reminder` — personalised chase for one property
- `draft_chase_all_overdue` — batch chase preview
- `update_owner_contact` — phone/email change preview

**Workflow tools:**
- `daily_briefing` — morning summary

**WA mining tenement tools** *(in progress — see `src/wa-tenements.ts`)*:
- `find_mining_mismatches` — cross-reference rated land use with active tenements
- `generate_evidence_pack` — produce a council-grade reclassification case file

## Development workflow

```bash
npm install          # install dependencies
npm run build        # type-check and compile
npm start            # run the compiled server (rare — usually launched by Claude Desktop)
```

Make changes in `src/`, rebuild, and either restart Claude Desktop or re-run the smoke test.

## Companion: MCP reference library

A local mirror of the full Model Context Protocol documentation lives at:

- **[`~/.claude/reference/mcp/`](file:///Users/Brodie/.claude/reference/mcp/)** — 108 pages, mirrored from `modelcontextprotocol.io`
- **[`~/.claude/reference/mcp/INDEX.md`](file:///Users/Brodie/.claude/reference/mcp/INDEX.md)** — entry point

Use this for any MCP architecture questions; faster than refetching docs.

## Other prototypes in this MCP workspace

- **[`/Users/Brodie/MCP/hello-mcp`](file:///Users/Brodie/MCP/hello-mcp)** — first MCP build, learning scaffold (echo, add, greeting resource, introduce prompt). Use as a reference for MCP basics.

## Contact

| Role | Email |
|---|---|
| General | `hello@ratesassist.com.au` *(provisional)* |
| Pilots | `pilots@ratesassist.com.au` *(provisional)* |
| Security | `security@ratesassist.com.au` *(provisional)* |
| Privacy | `privacy@ratesassist.com.au` *(provisional)* |

---

*RatesAssist — Vertical AI for Australian local government rates.*
*© RatesAssist (entity TBC). Confidential.*
