# Advocate

**Advocate** is an agent-native decision workspace for humans and AI agents to reason together without hiding uncertainty. Humans define the decision, criteria, and judgment. WebMCP-aware agents can inspect the same visible workspace, search it, add grounded claims/evidence/questions/actions, stress-test a position, audit evidence gaps, assess readiness, and generate a structured decision brief.

Built for **The WebMCP Challenge** (August 25–September 3, 2026).

## Why WebMCP is essential here

Decision work is stateful and structured. A normal browser agent has to infer UI controls, scrape cards, and guess which changes are safe. Advocate exposes explicit capabilities through `document.modelContext.registerTool(...)`, so an agent can interact with the decision model directly while the human sees the same state update in the UI.

The app registers these tools:

- `get_decision_workspace` — inspect current claims, evidence, criteria, questions, actions, and stats
- `search_workspace` — search recorded reasoning before inventing or duplicating work
- `add_claim` — add grounded supporting/opposing/neutral claims
- `add_evidence` — add real evidence and optionally link it to claims
- `surface_counterarguments` — stress-test one side using existing opposition, unknowns, and criteria
- `find_evidence_gaps` — identify unsupported or thinly supported claims
- `add_open_question` — record unresolved blockers
- `resolve_question` — mark questions resolved with an explicit resolution
- `create_action` — turn uncertainty into owned follow-up work
- `assess_decision_readiness` — score structural readiness without pretending to make the decision
- `generate_decision_brief` — produce an auditable synthesis while preserving human judgment

The implementation uses the current WebMCP imperative API on `document.modelContext`. The UI remains fully usable in browsers without WebMCP as a progressive enhancement.

## Human + agent experience

A person can add and resolve claims, evidence, questions, and actions through the visible interface. A WebMCP-aware agent can work on exactly the same browser-local workspace. Agent mutations are recorded in the activity model and immediately reflected in the human UI.

Useful prompts:

1. `Inspect this decision workspace and tell me what evidence is missing.`
2. `Stress-test the case for this decision, then add only well-grounded counterclaims.`
3. `Assess decision readiness and create concrete actions for the biggest gaps.`
4. `Generate a decision brief that preserves unresolved uncertainty.`

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

For WebMCP testing in Google Chrome 149+, enable:

```text
chrome://flags/#enable-webmcp-testing
```

Then relaunch Chrome. The challenge also supports testing through ChatGPT's in-app browser.

## Test and build

```bash
npm install
npm run check
```

`npm run check` runs the Node test suite and a production Vite build. The tests cover normalization, search, evidence-gap auditing, counterargument generation, readiness scoring, decision-brief behavior, hostile-looking search input, result bounds, and a 5,000-claim stress case.

## Architecture

```text
index.html
src/
  domain.js   # deterministic decision-domain logic
  main.js     # human UI + local persistence
  style.css   # responsive product UI
  webmcp.js   # WebMCP tool registration and execution
 test/
  domain.test.js
```

No backend, API key, account, or proprietary service is required. Workspace data stays in `localStorage`, making the judge experience immediate and reliable.

## WebMCP safety choices

- Read-only tools declare `readOnlyHint: true`.
- Mutating tools are narrow and schema constrained.
- Evidence tooling explicitly tells agents not to fabricate sources.
- Agent-generated/externally supplied text is treated as untrusted content where appropriate.
- Tool handlers validate referenced claim/evidence IDs instead of accepting arbitrary links.
- Decision-readiness scoring is transparent and structural; it never claims to replace human judgment.
- The final brief explicitly leaves the actual decision to the human.

## Hackathon fit

**WebMCP leverage:** the core product becomes substantially more useful when an agent can operate on structured decision state rather than clicking through UI heuristically.

**Execution:** Advocate is a complete responsive product experience with local persistence, human controls, agent tools, a decision-readiness model, evidence auditing, and an auditable brief.

**Potential impact:** teams routinely lose context across meetings, docs, chat threads, and AI conversations. Advocate gives people and agents one inspectable reasoning surface with explicit unknowns and evidence links.

**Creativity & ambition:** instead of making an agent "decide for you," Advocate uses WebMCP to separate mechanical reasoning work from human accountability.

## Submission testing checklist

- Open the deployed site in ChatGPT's in-app browser or WebMCP-enabled Chrome.
- Confirm the WebMCP status pill reports tools ready.
- Ask the agent to inspect the workspace.
- Ask it to find evidence gaps.
- Ask it to add one grounded counterclaim or open question and verify the visible UI changes.
- Ask it to assess readiness and generate the decision brief.
- Refresh the page and confirm browser-local state persists.

## Demo video outline (<3 minutes)

1. **0:00–0:15** — show Advocate already open; state the problem: decisions are scattered and agents normally have to guess through UIs.
2. **0:15–0:45** — show the human argument map, evidence, open questions, criteria, readiness score.
3. **0:45–1:30** — ask a WebMCP-aware agent to inspect the workspace and find evidence gaps; show structured tool use.
4. **1:30–2:05** — ask it to add a grounded counterclaim/open question; show the UI update immediately.
5. **2:05–2:35** — ask it to assess readiness and generate a brief.
6. **2:35–2:55** — explain that WebMCP lets agents use explicit capabilities while the human retains final judgment.

## License

MIT — see [LICENSE](./LICENSE).
