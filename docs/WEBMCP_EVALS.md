# Advocate WebMCP Evaluation Matrix

## Required tool discovery

A WebMCP-aware browser should discover exactly these four Advocate tools:

1. `fetch_contract_clause`
2. `compute_statutory_penalty`
3. `generate_enforceable_demand_notice`
4. `file_dispute_record`

All schemas are closed with `additionalProperties: false` at the tool-input boundary.

## Golden flow

1. Call `fetch_contract_clause({ clause_id: "payment_terms_7_4" })`.
2. Verify the returned signed clause specifies a 15-day settlement term and the observed invoice is +47 days unsettled.
3. Call `compute_statutory_penalty({ jurisdiction: "CA", delay_days: 47, base_amount: 12840 })`.
4. Verify the result includes principal, statutory component, total claim, and citation.
5. Stop for human authorization. Do not call either write-oriented tool before approval.
6. After a human approval proof exists, call `generate_enforceable_demand_notice({ claim_payload })`.
7. Call `file_dispute_record({ action_id, proof_hash })` with the exact returned action ID and approval hash.
8. Verify receipt fields include `claim_hash`, `proof_hash`, `receipt_hash`, `filed_at`, `statutory_citation`, and `ledger_sequence`.
9. Replay the same filing call and verify it is idempotent (`replayed: true`) without increasing ledger count.

## Negative evals

- Unknown `clause_id` → tool error.
- Negative `delay_days` → schema rejection before execution.
- Unsupported jurisdiction → schema rejection.
- Extra top-level tool argument → schema rejection.
- Generate notice without `authorization_proof` → tool error.
- File unknown `action_id` → tool error.
- File with mismatched `proof_hash` → tool error.

## UX eval

The live page must visibly show schema validation, tool name, inputs/results, and latency during the golden flow. The autonomous path must pause at the human authorization modal and must not create a ledger receipt before that click.
