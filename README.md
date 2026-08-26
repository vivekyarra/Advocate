# Advocate

> **Your agent should fix your bill, not open a support ticket.**

**Live demo:** https://advocate-live-cinevault7-8566s-projects.vercel.app

Advocate is a WebMCP-native customer account portal where a customer’s agent can investigate a billing problem, prove what went wrong, show the customer the exact fix, and execute it after approval.

No chatbot. No generic “AI insights” panel. The customer keeps the normal ISP portal they already understand; WebMCP gives their agent a reliable, structured interface to the same account state.

## The 15-second demo

Open the live app in ChatGPT’s in-app browser and say:

> “My bill is way higher than usual and my internet was down on Saturday. Find out why and fix anything I’m entitled to, but ask me before changing my plan.”

The seeded demo account starts with:

- Current bill: **$94.37**
- Previous bill: **$59.00**
- Confirmed Aug 22 outage: **6h 42m**
- Expired promotion: **+$25.00**
- Incorrect installation fee: **+$10.37**
- Eligible outage credit: **$12.80**
- Total recoverable now: **$23.17**
- Equivalent current plan: **$67/mo**, saving **$17/mo**

After the customer approves **Fix bill only**, the agent can apply the credit and refund. The actual browser database ledger changes and the amount due becomes **$71.20**. Plan-change tools remain technically blocked because the human did not approve a plan.

## Why WebMCP is essential

A normal browser agent must infer intent from UI text, navigate pages, and actuate controls. Advocate exposes the account’s authorized capabilities directly with JSON Schema contracts. The page and the agent share one source of truth, so tool calls visibly update the same portal the customer is looking at.

The app uses the current imperative API (`document.modelContext.registerTool`) and follows Chrome’s WebMCP security guidance:

- explicit JSON Schemas for every tool
- `readOnlyHint: true` on inspection tools
- `readOnlyHint: false` on account-changing tools
- concise first-party tool outputs
- no cross-origin tool exposure
- human approval enforced in application state, not merely suggested in prose
- idempotent write operations, so retries cannot double-credit the account

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

The implementation is in [`src/webmcp.js`](src/webmcp.js):

```js
await document.modelContext.registerTool({
  name: 'get_current_bill',
  description: 'Read the customer’s current bill, amount due, due date, status, and active plan.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, untrustedContentHint: false },
  execute: async () => JSON.stringify(await service.getCurrentBill())
});
```

## Human approval is a hard boundary

The important safety property is not “the agent should remember to ask.” Advocate stores a scoped approval in the account database when the customer clicks a resolution button.

- **Fix bill only** grants the billing-fix scope.
- **Fix bill + switch plan** grants the billing-fix scope plus one exact `plan_id`.
- `apply_outage_credit` and `refund_invalid_charge` fail before billing approval.
- `change_plan` fails unless the customer approved the exact requested plan ID.
- Bill-only approval can never be reused as plan approval.

This is intentionally redundant with browser/agent confirmation UX: the product itself enforces the user’s boundary.

## Real state, not a toast

For hackathon reliability, each visitor receives an isolated seeded account in **IndexedDB** (`advocate-demo-account`). That is a real persistent browser database: actions survive reloads until the user clicks the reset control.

The current balance is derived from the original bill plus immutable ledger adjustments. Credits and refunds are idempotent: repeated or concurrent tool invocations cannot duplicate a recovery.

This architecture avoids shared-demo collisions between judges, requires no credentials, and makes the exact demo repeatable.

## Run locally

Requirements: Node.js 20+ and a modern browser.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

To test actual WebMCP locally, use either:

1. ChatGPT’s in-app browser, which supports WebMCP for this challenge; or
2. Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled, then restart Chrome.

The top-right status pill shows when browser-native tools registered successfully.

## Test and stress test

No runtime or build dependencies are required.

```bash
npm test
npm run test:stress
npm run build
# or all three:
npm run check
```

The stress suite creates **750 fresh accounts**, varies tool order, probes unauthorized writes, hammers concurrent duplicate credit/refund calls, and checks ledger, balance, plan, receipt, approval, and idempotency invariants on every run.

Expected final bill-only receipt:

```text
Previous bill:       $94.37
Outage credit:      -$12.80
Invalid fee refund: -$10.37
New balance:         $71.20
Plan changed:        No
```

## Project structure

```text
index.html               Normal customer portal UI
src/seed.js              Deterministic ISP demo account
src/repository.js        IndexedDB + in-memory test repositories
src/domain.js            Billing, eligibility, approval, ledger logic
src/webmcp.js            14 browser-native WebMCP tools
src/ui.js                Shared page-state rendering and live activity
src/styles.css           Responsive portal design
scripts/build.mjs        Dependency-free production build + rule checks
scripts/serve.mjs        Dependency-free local server
scripts/stress.mjs       High-volume invariants / retry stress test
tests/                   Domain and WebMCP contract tests
vercel.json              Static hosting + WebMCP-compatible headers
```

## Hackathon testing instructions

1. Open the deployed URL in ChatGPT’s in-app browser.
2. Confirm the header says **WebMCP ready · 14 tools**.
3. Use the prompt from “The 15-second demo” above.
4. Watch the normal portal update as tools inspect the bill and outage.
5. When **We found 2 fixes** appears, click **Fix bill only — $23.17 recovered**.
6. Let the agent apply the outage credit and invalid-fee refund.
7. Confirm the live balance becomes **$71.20** and a resolution receipt appears.
8. Ask the agent to change the plan anyway. It should fail because no exact plan approval exists.
9. Click the reset icon in the header to restore the pristine demo account.

## WebMCP Challenge fit

**WebMCP leverage:** The product’s core workflow is a coordinated sequence of structured read and write tools, with schemas, shared page state, read/write annotations, deterministic outputs, and application-level approval boundaries.

**Execution:** Advocate is a complete account portal, not a tool-registration proof of concept. It includes billing, plan, outage, usage, support, live investigation state, approvals, ledger mutation, receipt generation, responsive design, and resettable judging state.

**Potential impact:** Billing disputes are common, low-complexity problems hidden behind high-friction support journeys. Advocate shows a direct alternative: let the customer’s own agent operate the provider’s authorized account capabilities.

**Creativity & ambition:** The interface is not “AI customer support.” It is customer support **without a support conversation**—a portal that treats the customer’s agent as a first-class authorized user while keeping the human in control of sensitive decisions.

## License

MIT. See [LICENSE](LICENSE).
