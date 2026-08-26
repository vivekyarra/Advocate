# Advocate · WebMCP Enforcement Mission Control

Advocate is a browser-native enforcement simulation built for the OpenAI WebMCP Challenge. It turns a signed contractual obligation into a human-authorized, agent-executed action with an inspectable cryptographic receipt.

## Demo path

`Live ingestion → Entitlement calculation → Human authorization → WebMCP execution → SHA-256 receipt`

The hero screen runs the complete flow from one button. The only interruption is the required human approval immediately before the simulated irreversible filing action.

## WebMCP surface

Advocate exposes four JSON-schema tools:

- `fetch_contract_clause(clause_id)`
- `compute_statutory_penalty(jurisdiction, delay_days, base_amount)`
- `generate_enforceable_demand_notice(claim_payload)`
- `file_dispute_record(action_id, proof_hash)`

The app registers tools against the current canonical `document.modelContext` WebMCP producer API, falls back to the deprecated `navigator.modelContext` compatibility surface when present, and always exposes an inspectable `window.__webmcp` runtime mirror for the local demo path.

Every invocation emits live telemetry for schema validation, typed inputs, tool execution, results/errors, and latency. Filing is idempotent by action ID.

## Human authorization and receipts

Before notice generation or filing, Advocate pauses the autonomous flow and requires a single explicit click. That gesture creates a SHA-256 approval proof bound to the execution intent, timestamp, and nonce. The final receipt includes:

- action ID and UTC filing timestamp
- claim hash
- authorization proof hash
- statutory citation used by the simulation
- ledger sequence
- receipt hash
- downloadable PDF representation

This repository is a product demonstration, not legal advice. Statutory rules must be re-verified before any production legal workflow.

## Local verification

```bash
npm run check
npm run build
npm start
```

`npm run check` performs syntax linting, WebMCP schema/flow tests, idempotency tests, and the production build. The app has no runtime dependencies.

## Vercel

`vercel.json` runs `npm run build` and serves `dist/`. WebMCP requires a secure context, so the Vercel HTTPS deployment is the intended evaluation environment.
