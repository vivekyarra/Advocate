# Advocate

> **Your agent should fix your bill, not open a support ticket.**

Advocate is a WebMCP-native customer account portal that combines a normal, polished broadband account experience with structured browser tools an authorized agent can use to investigate and resolve billing problems.

**Live product:** https://advocate-live-cinevault7-8566s-projects.vercel.app

## Product experience

Advocate now behaves like an actual account product rather than a hackathon control panel:

- create an account or sign in with email and password
- open an isolated live demo account without sharing credentials with other judges
- persistent authenticated profile and broadband account data
- full account overview, billing, usage, outage, plans, support, profile, and settings screens
- editable name, phone, service address, timezone, communication preferences, autopay, and paperless settings
- real password-change flow through managed authentication
- persisted support requests with request history
- real statement views and print-friendly statement/receipt flows
- explicit confirmation dialogs for plan changes and bill-changing actions
- responsive desktop, tablet, and mobile navigation
- signed-in WebMCP tools bound to the same account state the customer sees

The live challenge scenario is still available to every account, but each user gets their own persistent copy rather than a shared global demo record.

## The 15-second WebMCP demo

Open the live app in a WebMCP-aware browser, choose **Explore live demo**, then say:

> “My bill is way higher than usual and my internet was down on Saturday. Find out why and fix anything I’m entitled to, but ask me before changing my plan.”

The seeded billing scenario starts with:

- Current bill: **$94.37**
- Previous bill: **$59.00**
- Confirmed Aug 22 outage: **6h 42m**
- Expired promotion: **+$25.00**
- Incorrect installation fee: **+$10.37**
- Eligible outage credit: **$12.80**
- Total recoverable now: **$23.17**
- Equivalent plan: **$67/mo**, saving **$17/mo**

After the customer approves **Fix bill only**, the outage credit and invalid-fee refund are written to the account ledger and the balance becomes **$71.20**. A plan change remains blocked unless the customer separately approves the exact plan.

## Real backend and identity

The production app uses **Neon Postgres + Neon Auth + Neon Data API**.

Authentication, profiles, account records, bills, charges, outages, ledger entries, approvals, activity, usage, support requests, and settings are persisted server-side. The browser never receives database credentials.

Security boundaries are enforced in the database layer as well as the UI:

- all application tables use PostgreSQL Row Level Security
- authenticated users can read only their own account-scoped data
- anonymous direct table access is revoked
- authenticated clients cannot directly insert/update/delete protected account tables
- sensitive changes go through scoped database functions that re-check the authenticated user and required approval
- outage credits and charge refunds have database uniqueness constraints, so retries cannot create duplicate money movements
- plan changes require an approval for the exact target plan ID
- demo reset is permitted only on accounts created as demo accounts

## Why WebMCP is essential

A normal browser agent must infer intent from UI text, navigate pages, and actuate controls. Advocate exposes the account’s authorized capabilities directly with JSON Schema contracts. The page and the agent share one source of truth, so tool calls update the same account the customer is viewing.

The app uses the current imperative API (`document.modelContext.registerTool`) and follows WebMCP security guidance:

- explicit JSON Schemas for every tool
- `readOnlyHint: true` on inspection tools
- `readOnlyHint: false` on account-changing tools
- concise first-party tool outputs
- human approval enforced in application/database state, not merely suggested in prose
- idempotent monetary writes

## WebMCP tool surface

| Tool | Purpose | Mutates account? |
| --- | --- | --- |
| `get_current_bill` | Read current amount due and plan | No |
| `get_previous_bills` | Read prior statements | No |
| `compare_bills` | Explain exact month-over-month change | No |
| `get_outage_history` | Read confirmed outage events | No |
| `explain_charge` | Explain a bill charge | No |
| `check_credit_eligibility` | Verify outage-credit entitlement | No |
| `check_charge_validity` | Validate/refundability check | No |
| `list_plan_options` | Compare available plans | No |
| `get_resolution_summary` | Build exact proposed resolution | No |
| `get_approval_status` | Read current human approval scope | No |
| `apply_outage_credit` | Write eligible outage credit to ledger | **Yes** |
| `refund_invalid_charge` | Write invalid-fee refund to ledger | **Yes** |
| `change_plan` | Change plan after exact-plan approval | **Yes** |
| `get_resolution_receipt` | Read final receipt | No |

## Human approval is a hard boundary

The important property is not “the agent should remember to ask.” Advocate stores a scoped approval and checks it again when a sensitive database operation is requested.

- **Fix bill only** approves eligible billing fixes, not a plan.
- **Fix bill + switch plan** approves billing fixes plus one exact plan ID.
- A direct plan choice has its own explicit confirmation and exact-plan approval.
- `apply_outage_credit` and `refund_invalid_charge` fail without billing approval.
- `change_plan` fails unless the authenticated customer approved that exact plan.
- duplicate writes are idempotent and do not duplicate credits/refunds.

## Product navigation

### Overview
Account summary, current bill, service status, active plan, guided resolution center, live account activity, and post-resolution receipt.

### Billing
Current statement, individual charges/adjustments, statement history, payment preferences, and print-friendly statement output.

### Usage
Current and prior monthly transfer totals and service speed context.

### Outages
Confirmed outage history with duration, reason, and credit eligibility workflow.

### Plans
Current plan plus available alternatives. Changing plans always requires an explicit confirmation.

### Support
Persisted customer support requests with category, subject, message, status, and request history.

### Profile
Editable identity/contact/service-address information and timezone.

### Settings
Autopay, paperless billing, notifications, password changes, sign out, and demo-only scenario reset.

## Run locally

Requirements: Node.js 20+.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

The production auth service trusts the deployed Advocate origin. For local UI development, the static app can be inspected locally, while full hosted authentication should be validated on the production origin.

## Test and stress test

No runtime or build dependencies are required.

```bash
npm test
npm run test:stress
npm run build
# or all three:
npm run check
```

The suite covers the original billing domain, WebMCP contracts, the authenticated cloud adapter, approval boundaries, idempotent money movement, and deterministic challenge math. The stress suite creates **750 fresh account states**, probes unauthorized writes, hammers duplicate concurrent mutations, and checks ledger/balance/plan/receipt invariants.

Expected bill-only result:

```text
Previous bill:       $94.37
Outage credit:      -$12.80
Invalid fee refund: -$10.37
New balance:         $71.20
Plan changed:        No
```

## Project structure

```text
index.html               Authenticated product shell and account screens
src/cloud.js             Neon Auth/Data API client + cloud account service
src/main.js              Session bootstrap, login/signup/demo access, WebMCP router
src/ui.js                Product navigation, forms, dialogs, account workflows
src/styles.css           Responsive product design system + print styles
src/webmcp.js            14 browser-native WebMCP tools
src/domain.js            Deterministic billing domain used by tests/local model
src/repository.js        In-memory/IndexedDB repositories for deterministic tests
src/seed.js              Challenge scenario fixture
scripts/build.mjs        Production checks + static build
scripts/serve.mjs        Dependency-free local server
scripts/stress.mjs       High-volume mutation/invariant stress suite
tests/                   Domain, WebMCP, and cloud-adapter tests
vercel.json              Hosting/security headers
```

## Challenge testing instructions

1. Open https://advocate-live-cinevault7-8566s-projects.vercel.app.
2. Choose **Explore live demo** to create an isolated authenticated demo account.
3. Confirm the header reports the WebMCP tool status in a compatible browser.
4. Use the prompt from “The 15-second WebMCP demo.”
5. Watch the normal account portal update as tools inspect the bill and outage.
6. When the resolution appears, approve **Fix bill only**.
7. Confirm the balance becomes **$71.20** and the persisted receipt appears.
8. Ask the agent to change the plan anyway; it should fail because no exact plan approval exists.
9. Use **Settings → Reset demo scenario** to restore that demo account when desired.

## Real-world integration boundary

Advocate’s identity, persistence, account isolation, profile/preferences, support requests, approval enforcement, and billing ledger are real production-backed product features. The broadband carrier data in this public challenge deployment is intentionally seeded because no live ISP provisioning, payment-processor, or carrier billing API credentials are part of this repository. Connecting those external systems would replace the seed/account-provisioning adapters without changing the product or WebMCP interaction model.

## License

MIT. See [LICENSE](LICENSE).
