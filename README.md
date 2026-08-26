# Advocate

> **Your agent should fix your bill, not open a support ticket.**

Advocate is a WebMCP-native broadband account portal where a customer and an authorized browser agent can investigate a billing problem together, verify real entitlements, apply approved credits/refunds, and optionally change a plan — against the same authenticated account state the human sees.

**Live product:** https://advocate-live.vercel.app/

## Judge it in 60 seconds

1. Open the live product in ChatGPT's in-app browser or Chrome 149+ with WebMCP enabled.
2. Choose **Explore with an isolated live demo account**. No shared credentials are required.
3. Ask:

> My bill is way higher than usual and my internet was down on Saturday. Find out why and fix anything I'm entitled to, but ask me before changing my plan.

4. The agent can use `investigate_bill_issue` to gather the complete evidence trail in one read-only operation while the normal account UI updates with the findings.
5. In **Resolution center**, choose **Fix bill only**.
6. The agent can call `apply_approved_resolution`. The backend re-checks the human approval, applies the eligible $12.80 outage credit and $10.37 invalid-fee refund, and returns a receipt.
7. The balance moves from **$94.37 → $71.20**. The plan does **not** change because no plan was approved.

Try the negative case too: ask the agent to change the plan after approving only the bill fixes. The plan write is rejected because the approval is scoped to an exact plan ID.

## Why this is a strong WebMCP use case

Customer-support portals are a poor fit for DOM guessing. A billing investigation crosses statements, line items, outage history, policy eligibility, plan comparisons, approvals, and money-moving actions. A generic browser agent has to infer what every control means and whether an action is safe.

Advocate exposes those account capabilities directly through `document.modelContext.registerTool()` with explicit JSON Schema contracts. The human and the agent share the same signed-in state and the same visible product surface:

- the **agent** is good at gathering evidence, comparing records, and executing structured actions;
- the **human** remains the authority for sensitive choices;
- the **site/backend** enforces what either party is actually allowed to do.

This is not a chat widget layered over a portal. WebMCP is the interaction layer that lets an external browser agent safely operate the product.

## 16 browser-native WebMCP tools

Advocate exposes two intent-level tools for reliable task completion and fourteen granular tools for inspectability, composability, and agent choice.

### Intent-level workflow

| Tool | Purpose | Mutates account? |
| --- | --- | --- |
| `investigate_bill_issue` | End-to-end evidence collection: compare bills, verify outage credit, validate suspicious charges, and surface a plan opportunity | No |
| `apply_approved_resolution` | Apply only the resolution already approved by the human; underlying controls re-check approval and idempotency | **Yes** |

### Granular capability surface

| Tool | Purpose | Mutates account? |
| --- | --- | --- |
| `get_current_bill` | Current amount due, due date, status, plan | No |
| `get_previous_bills` | Previous statements | No |
| `compare_bills` | Exact month-over-month changes | No |
| `get_outage_history` | Confirmed outage events | No |
| `explain_charge` | Explain a current charge | No |
| `check_credit_eligibility` | Verify outage-credit entitlement | No |
| `check_charge_validity` | Verify whether a charge is refundable | No |
| `list_plan_options` | Compare available plans and savings | No |
| `get_resolution_summary` | Summarize verified fixes and approval scope | No |
| `get_approval_status` | Read the human's current approval | No |
| `apply_outage_credit` | Apply one eligible outage credit | **Yes** |
| `refund_invalid_charge` | Refund one verified invalid charge | **Yes** |
| `change_plan` | Change only to an exactly approved plan | **Yes** |
| `get_resolution_receipt` | Read the final case receipt | No |

All tool names stay within the recommended WebMCP character budget, descriptions are concise, schemas reject undeclared properties, and read/write annotations are explicit.

## The seeded challenge scenario

The public demo is intentionally deterministic so every judge can reproduce the same account problem in an isolated account:

- current bill: **$94.37**
- previous bill: **$59.00**
- promotion expired: **+$25.00**
- invalid installation fee: **+$10.37**
- confirmed Aug 22 outage: **6h 42m**
- eligible outage credit: **$12.80**
- total immediately recoverable: **$23.17**
- projected corrected balance: **$71.20**
- equivalent 500 Mbps plan: **$67/mo**, saving **$17/mo**

The carrier/billing fixture is seeded; the identity, persistence, authorization, approvals, ledger writes, profile/settings, support requests, and account isolation are production-backed.

## Human approval is a hard security boundary

The important property is not a prompt telling the agent to ask first. Approval is persisted and checked again at the account mutation boundary.

- **Fix bill only** authorizes eligible billing corrections and no plan change.
- **Fix bill + switch plan** authorizes the billing corrections plus one exact plan ID.
- `apply_outage_credit` and `refund_invalid_charge` reject calls without bill-fix approval.
- `change_plan` rejects calls unless its `plan_id` exactly matches the persisted human approval.
- `apply_approved_resolution` is only orchestration; it cannot bypass those lower-level checks.
- monetary writes are idempotent, so retries do not duplicate credits or refunds.
- PostgreSQL Row Level Security isolates customer data by authenticated user.
- browser clients cannot directly write protected account tables; sensitive writes go through scoped database functions.

Vercel also sends `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)` so the production document satisfies WebMCP's origin-isolation and permissions model.

## Product experience beyond the demo

Advocate is a complete account portal rather than a WebMCP control panel:

- sign in, sign up, and isolated one-click demo access
- overview, billing, usage, outages, plans, support, profile, and settings
- persisted profile/contact/service-address preferences
- managed password change
- AutoPay, paperless, and notification preferences
- support request creation and history
- statement and receipt printing
- explicit confirmation dialogs for plan/bill-changing actions
- responsive desktop/tablet/mobile navigation
- live account activity and resolution receipts
- signed-in WebMCP tools bound to the exact account state shown on screen

## Architecture

```text
ChatGPT / WebMCP-aware browser agent
                 │
                 │ document.modelContext.registerTool
                 ▼
        ┌──────────────────────┐
        │  Advocate web app    │
        │  normal human UI     │
        │  + 16 WebMCP tools   │
        └──────────┬───────────┘
                   │ authenticated JWT
                   ▼
        ┌──────────────────────┐
        │ Neon Data API / RPC  │
        └──────────┬───────────┘
                   ▼
        ┌──────────────────────┐
        │ Neon Postgres        │
        │ RLS + approval rules │
        │ idempotent ledger    │
        └──────────────────────┘
```

The browser never receives database credentials.

## WebMCP evaluation strategy

The repository includes deterministic contract tests for the browser tool surface and a reproducible manual eval matrix in [`docs/WEBMCP_EVALS.md`](docs/WEBMCP_EVALS.md).

The automated WebMCP tests verify:

- all 16 tools are unique and within recommended name/description budgets;
- JSON Schemas and read/write annotations are present;
- the intent-level investigation returns the exact evidence and recovery math;
- the intent-level write is blocked before human approval;
- bill-only approval cannot cause a plan change;
- repeated resolution calls remain idempotent.

The broader stress suite creates **750 fresh account states**, probes unauthorized writes, hammers duplicate concurrent mutations, and verifies ledger/balance/plan/receipt invariants.

## Run and verify

Requires Node.js 20+ and no runtime/build dependencies.

```bash
npm run dev
npm test
npm run test:stress
npm run build
# everything CI runs:
npm run check
```

Open `http://127.0.0.1:4173` for local static development. Full hosted authentication is validated on the configured production origin.

## Project structure

```text
index.html               Authenticated product shell and account screens
src/main.js              Session bootstrap + WebMCP registration
src/webmcp.js            16 browser-native WebMCP tools and safe orchestration
src/cloud.js             Neon Auth/Data API client + cloud account service
src/ui.js                Product navigation, dialogs, account workflows
src/styles.css           Responsive product design system + print styles
src/judge-polish.js      Agent-status + notification UX
src/domain.js            Deterministic billing domain for tests
src/repository.js        In-memory/IndexedDB repositories
src/seed.js              Reproducible challenge fixture
scripts/stress.mjs       High-volume authorization/idempotency stress suite
tests/                   Domain, cloud, product-shell, and WebMCP tests
docs/WEBMCP_EVALS.md     Manual agent eval matrix and expected outcomes
vercel.json              Production build and WebMCP/security headers
```

## Real-world integration boundary

This public challenge deployment does not claim to be connected to a real ISP provisioning system or payment processor. The broadband carrier data is intentionally seeded. Replacing the seed/account-provisioning adapter with carrier APIs would not change the WebMCP interaction model, authorization design, or human-approval boundary demonstrated here.

## License

MIT — see [LICENSE](LICENSE).
