# Poko

Poko is an AI guide that lives inside a vendor's product. It learns the product's
screens and routes from how people really use it, then walks new users through the
hard parts: it points to the next step, explains why, and waits for a yes before it
acts. Sekva was the working name, and parts of the docs and code still use it.

See [PLAN.md](PLAN.md) for the thesis, the business model and the phase plan, and
[DESIGN.md](DESIGN.md) for the learning guarantees and the status of each phase.

## Repository layout

| Folder | What it is |
| --- | --- |
| `site/` | The marketing landing page. Next.js, port 4800, standalone. |
| `service/` | The vendor console and its API. Next.js, port 4600, imports `core/`. |
| `core/` | The in-browser engine: observe, locate, highlight, act, record and redact. |
| `panel/` | The in-product panel, presentation only. |
| `sdk/` | The installable SDK package. A scaffold for now. |
| `dev/` | The local harness (a mock product and the panel side by side) and the tests. |
| `eval/` | Planner evaluations: scenarios, scoring, with/without comparisons and past runs. |
| `fixture/` | A mock Jira and a multi-page site for exploration. |
| `plans/` | The hardcoded plan from Phase 0. |

## Getting started

Needs Node 26 (it runs the `.ts` and `.mts` scripts directly), npm and Python 3. Run
each command from the repository root, in its own terminal. Every server listens on
127.0.0.1 only.

```bash
cd site && npm install && npm run dev          # the landing page, http://127.0.0.1:4800

cp service/.env.local.example service/.env.local   # then fill in the values it lists
cd service && npm install && npm run dev       # the console and API, http://127.0.0.1:4600

python3 dev/serve.py 4500                      # the harness, http://localhost:4500/dev/harness.html
./dev/test-all.sh                              # every test that needs no browser and no model
```

The tests import the service's code, so install its dependencies first. Nothing here
calls a model on its own: every paid path needs an explicit action (see
[Nothing here calls the API on its own](#nothing-here-calls-the-api-on-its-own)).

## The console

One app for everything a vendor does with Sekva, light only, built around a map of
the product:

```bash
cd service && npm run dev
open "http://localhost:4600"          # the map of the product that has learned the most
```

- **Map.** Screens are stations, drawn from the controls they were seen to have;
  links people take are lines; learned routes are transit lines coloured by status.
  Layers: Traffic, Routes, Struggles, Docs, Explored (keys 1 to 5). Click a screen or
  a route; a route shows its numbered steps and its history. On a route that a
  with/without comparison tested, Compare (key C) draws where planning with the route
  and without it went their separate ways, including steps only the docs know.
- **Table.** The same routes, screens and struggles as rows. J and K move, Enter opens.
- **Struggles.** Where people get stuck and where the copilot was wrong, with where
  those people went next. Each one can become an evaluation scenario
  (eval/scenarios.added.json, run by the next comparison) or a docs gap note.
- **Evaluations.** Every with/without comparison, scenarios worst first, each plan
  shown as a diff of the other, and what G9 does with it.
- **Runs.** Everything that costs money. Every paid run opens its exact call count,
  estimated tokens and what is left today, and needs a tick. Confirming queues it: now,
  or for 09:00 the next day when it does not fit today's budget. A queued run can be
  cancelled until it starts, and never makes more calls than were approved. The token
  meter in the top bar is the sum of what the provider reported for each call.
- **Sources** (docs, exploration, browsers and enrollment codes) and **Setup**, a
  six-step checklist decided by what is stored.
- ⌘K finds any screen, route or page and runs free actions; ⌘B folds the sidebar. The
  console refreshes in place as data arrives.

The old `/onboard` and `/coverage` pages redirect into it.

## Self-learning onboarding

The direction since Phase 1: onboarding is one manual step (point at docs and
the app) and everything after that is learned from use. See [DESIGN.md](DESIGN.md)
for the eleven guarantees that make it fail-safe rather than just hopeful, and
the phase plan.

```bash
./dev/test-all.sh                                         # every suite, one verdict
open "http://localhost:4500/dev/harness.html?plan=hardcoded&learn=1"   # capture on
```

With `?learn=1` every action in the fixture becomes a transition (screen before,
action, screen after), redacted in the browser and stored in
`service/data/copilot.db`. The panel footer shows capture status whenever it is on.

Phases A to O and the console are built; DESIGN.md has the status of each. Verification
(Phase D) verified 4 of 4 routes on the synthetic product; the with/without eval (G9)
then showed two of them made planning worse, and three routes are now held back. The
console's map shows exactly where (open one of them and press Compare).

The Chrome extension was removed on 2026-09-25. Sekva is becoming an embeddable SDK (one
script tag in the vendor's app) built on alibaba/page-agent; until it lands, the dev
harness below is how to run the panel. The panel has three tabs. Plan shows the goal, a mini map of the screens a
route-following plan goes through with where you are, and the steps: A approves, S
skips, Cmd+Enter plans. When a learned step's screen is not the page you are on, it
says so and offers "Take me there": the way people go, found without a model, which
only opens pages and so needs one press for all of it. Activity shows what is being
learned, exploration, and the decisions kept on this machine.

```bash
open "http://localhost:4500/dev/harness.html?demo=route-offroute&stage=access"   # off the route, replayed, no call
```

```bash
node service/scripts/g9.mts eval/results/<run>.json    # what G9 would hold or release; --apply to do it
node service/scripts/verify.mts http://synthetic.localhost    # dry run: held routes due a re-check
node eval/run.mjs --confirm --origin http://synthetic.localhost --compare --include-held   # paid
```

Docs ingestion (Phase F) crawls a vendor's docs into the planner's corpus:

```bash
cd service && node scripts/ingest-docs.mts <start-url> --tool <name>
```

Read-only exploration (Phase G) maps a product's screens by opening its links in a
sandboxed hidden frame. It never clicks, and it refuses links that look like they
could change something. The fixture site runs on its own origin, so it is a separate
product:

```bash
python3 dev/serve.py 4502 --cors
open "http://localhost:4500/dev/harness.html?explore=1"    # then Explore in the panel footer
```

The site's server log is the proof: it lists every URL exploration requested.
`?site=http://localhost:4502/fixture/explore-site/edge/start.html` runs the edge cases
(a 404, a redirect, and a sign-in page that must stop the run).

## Phase 0: close the loop (done)

Phase 0 proves one thing only: that **observe, locate, highlight, approve, act,
re-observe** works end to end. There is deliberately no AI in the path. The plan
is a hardcoded JSON file.

The point is that the risky part of V1 is the loop, not the model. Building the
brain first is how you find out too late that the loop does not close.

## Engine layout

```
core/
  observer.js      DOM -> semantic tree (role, accessible name, state, rect)
  target.js        {role, name} -> the element on screen. Pure, no DOM.
  highlighter.js   the cursor: spotlight ring + caption
  executor.js      performs one approved action. Called only after approval.
  page-agent.js    page side of the protocol, used by the harness
  runner.js        panel side: plan state machine + transport-agnostic RPC
  redact.js        what may leave the browser in clear; shared with the server
  recorder.js      passive capture: every person's action becomes a transition
  uploader.js      redact first, then deliver; per product install and queue
  screencheck.js   is this the screen a learned step belongs on (G8)
  explore-rules.js which links exploration may open; shared with the server
  explorer.js      read-only exploration in a sandboxed hidden frame
panel/             the panel UI (presentation only)
plans/             hardcoded plans. Phase 1 replaces these with planner output.
fixture/           mock Jira, so the loop can be exercised without credentials,
                   and explore-site/, a multi-page site with dangerous links
dev/               harness + tests
```

## Run it

The harness puts the mock Jira and the panel side by side, talking over postMessage.

```bash
python3 dev/serve.py 4500
```

Then open `http://localhost:4500/dev/harness.html`.

Every dev server listens on 127.0.0.1 only. `dev/serve.py` serves only the folders the
harness and fixtures load (core, panel, fixture, plans, dev); the rest of the
project, above all `service/.env.local` and the database, answers 404. Do not serve the
project with `python3 -m http.server`: that serves the whole folder, key included, to the
network.

Run the matcher tests (no browser, no dependencies):

```bash
node dev/test-target.js
```

## The extension (removed)

Removed on 2026-09-25 in favor of the SDK. The rule it carried still holds: nothing here
may touch the real, logged-in Jira (`*.atlassian.net`) on this machine. All verification
runs against the local fixtures.

## Design notes

### What a real page taught the observer

First run against a real application (console.groq.com, read only) on 2026-09-23:
460 DOM elements down to 46 nodes, no truncation, ~396 tokens, on a page with one
`aria-label`, one explicit `role` and zero `h1`s. The core bet held: a usable
semantic layer can be derived without the app cooperating. Three defects showed up
that the hand-written fixture could never have surfaced, all now fixed.

**Containers were named with their whole subtree.** The `main` landmark and two
card-shaped `<a>` wrappers each took a 120-character blob of everything inside
them. Container roles are now named only from an explicit label or a heading they
contain, and a long name on any element falls back to its heading when it has one.
Names hitting the cap went from 3 to 1, and the one that remains is a promo link
with no heading, whose name genuinely is that sentence.

**`textContent` concatenates without separators**, producing "Build Fast on
GroqFast LLM inference". Text nodes are now joined with a space.

**The same name appeared on several controls**, because one model button is listed
under four category headings. `{role, name}` cannot address that. Nodes now carry
`within`, the nearest labelled ancestor or heading, and targets may specify it.

On that page 13 of 45 nodes shared a `(role, name)` pair. With `within` included,
**zero remain ambiguous.**

`within` is scored, never filtered on. A guessed role that disqualified its own
match is exactly how targeting failed before, and a guessed section would fail the
same way, so a wrong `within` costs rank rather than eliminating the candidate.

Caveat: 460 elements is a small page. The 250-node cap has still not been tested
on anything Jira-sized, and that is where truncation will actually bite.

**Observe the accessibility tree, not the DOM or screenshots.** It is semantic,
it survives cosmetic redesign, and it is small enough to fit in a prompt. In
Phase 0 that tree is derived from the DOM rather than read from Chrome's real
a11y tree, which avoids the debugger banner an extension would otherwise show.

**The executor's input contract is what the planner will emit.** A step names a
target as `{role, name}` and an action from a small fixed vocabulary. That means
Phase 1 swaps the plan source and changes nothing downstream.

**Act re-locates before acting.** The runner never trusts a node id from an
earlier observation, because the page moves under you.

**The screen signature reads only what is visible.** In a single page app every
screen is in the DOM at once and all but one are hidden, so `querySelector('h1')`
returns whichever comes first in document order rather than the one on screen.
Until this was fixed the signature reported a stale screen after every
navigation, which was invisible in the panel and wrong in every journal entry.

### Repair, exercised

`/api/repair` and the panel's Ask copilot button handle a step whose target
cannot be found. Reproduced deliberately with a step targeting `tab`/"Permissions"
on a screen where it is a `link`, which is the exact failure `gpt-oss-20b`
produced repeatedly. Ask copilot re-derives the target from the live screen,
returns `link`/"Permissions" in ~1.6s, and the step becomes approvable.

A repair is journaled as its own decision with `from` and `to`, so a planner
mistake that a human had to route around is distinguishable from a plan they
simply approved. That distinction is the point of keeping the log.

**Ambiguity is surfaced, not resolved.** Two equally good matches is a signal
the planner described the target badly. Phase 1 wants to see that, not have it
quietly papered over.

**Every decision is logged durably.** `core/journal.js` appends every approval,
rejection and repair to `chrome.storage.local` in the extension, or
`localStorage` in the harness, and survives reloads and new goals.

This is deliberately separate from the runner's `state.log`. That one is UI state
scoped to the current plan and cleared on reset, which is right for rendering
ticks next to steps and wrong for the thing the log is actually for. Approvals and
rejections are the signal on intent versus optimal path, and that only has value
if it outlives the session that produced it. For a while it did not: the log was
described as the Phase 2 training signal while living in memory and dying on every
reset.

Each entry records the goal, the plan's source and outcome, the step's intent and
reasoning, the target as *planned*, what was actually *located* on screen, the
screen signature, and the decision. The planned-versus-located pair is the useful
part, because it is the half the planner did not know. Entries share a `runId` per
plan so a run can be reconstructed. Capped at 1000, oldest dropped first, and a
storage failure loses one row rather than blocking an approval. Export from the
panel footer.


---

## Phase 1: the planner

Phase 1 replaces the hardcoded plan with a model call over the live semantic tree
plus the product's documentation. The contract fixed in phase 0 did not move: the
planner emits `{role, name}` targets and actions from the same three-verb
vocabulary the executor already performs, so the swap touched `setPlan` and
nothing below it.

### Nothing here calls the API on its own

Every path that spends money is reached only from an explicit human action, and
each one is gated:

- `service/lib/planner.ts` constructs the Groq client **inside** the call, never
  at module scope. Importing the module, typechecking it, or building the app
  cannot produce a request.
- The routes return **412** with a readable message when `GROQ_API_KEY` or
  `GROQ_MODEL` is unset, rather than an SDK stack trace.
- `scripts/list-models.mjs` prompts before it touches the API at all, even though
  it only reads metadata.
- The panel only plans when you type a goal and press **Plan it**. Plain Enter
  inserts a newline; only Cmd/Ctrl+Enter submits, so planning is never one stray
  keystroke away.
- `eval/run.mjs` refuses to start without `--confirm`, because it costs one call
  per scenario.
- `dev/harness.html?plan=hardcoded` replays the frozen phase 0 plan, so the whole
  runner path stays exercisable for free.

### Run the service

```bash
cp service/.env.local.example service/.env.local
cd service
node scripts/list-models.mjs    # pick a GROQ_MODEL your key can reach
npm run dev
```

`GROQ_MODEL` has no default on purpose. Groq's catalogue changes, and a hardcoded
id that 404s at runtime is worse than a startup error naming the fix.

`POST /api/plan` builds a plan from a goal plus an observation. `POST /api/repair`
re-targets a single step when the page has moved under the plan.

### Why repair instead of replan

A plan is written against screens the planner mostly could not see: it observes
the current screen and takes the rest from the docs. A target going missing is
therefore expected, not exceptional. Repair re-derives one step's target from what
is actually on screen, which is cheaper than discarding a plan the user already
approved steps from, and it reuses phase 0's "not found" seam.

### Retrieval

`service/lib/retrieval.ts` is lexical, not embeddings. With a corpus this small an
embedding call per request would cost money and latency to rank six sections, and
below `WHOLE_CORPUS_CHAR_BUDGET` the whole corpus is sent whole instead, so
nothing relevant can be ranked out. Retrieval earns its place once a real vendor
corpus stops fitting. The module is the seam: replace `score()` with a vector
search and nothing else moves.

### Provider

Groq, via `groq-sdk`. Structured output is `response_format: {type: 'json_schema'}`
written to the strict-mode subset. Strict adherence varies by model on Groq, so
the response is validated with Zod on the way back rather than trusted: a model
that returns the wrong shape produces a readable error naming the bad field,
not a crash deeper in the runner.

Two things the Anthropic version had that Groq does not: explicit prompt-cache
breakpoints, and adaptive thinking. The stable content still goes first in case
automatic prefix caching applies. If a reasoning model leaks its thinking into
the content and breaks the JSON parse, set `GROQ_REASONING_FORMAT=hidden`; it is
unset by default because non-reasoning models reject the parameter.

### The eval

```bash
node eval/run.mjs --confirm        # one paid call per scenario
node eval/score.mjs eval/results/<stamp>.md
```

Eight scenarios, and the interesting ones are not the happy path: a shared scheme
that must trigger a copy-first warning, a request that is really about Access
rather than Permissions, a question that must produce no mutations at all, a goal
the product cannot do at all (a refusal is the correct answer), and the same goal
from the destination screen, which should produce one step rather than a replayed
five-step route.

The automatic checks are a filter, not the metric. They catch structurally broken
plans for free. The number that decides this is the accept rate a human SME writes
into the grading sheet, which is why `run.mjs` emits one and `score.mjs` reads it
back against the 70% and 40% bars from PLAN.md.


### Result, 2026-09-23

`openai/gpt-oss-20b` on Groq, 13 scenarios, graded against the fixture's ground
truth (would it run, and is it the narrowest correct change).

| | accept rate |
|---|---|
| first run, before any tuning | 2/8, 25% |
| after nullable roles + sharpened rules + documenting what the product lacks | 11/13, 85% |
| after adding the partial and nothing_to_do outcomes | 11/13, 85% |
| same suite on `openai/gpt-oss-120b` | 12/13, 92% |
| 18 scenarios, 4 partial cases and 2 over-fire guards | 17/18, 94% |

### Is `partial` calibrated, or creeping?

The worry with a fourth outcome is that it starts firing on every caveat and the
banner degrades into wallpaper. Testing only true partials could not answer that,
so the suite carries two deliberate near-misses that must come back `plan`.

Result: `partial` fired on 4 of 4 true partials and 0 of 2 guards.

The decisive pair is `read-only-happy` against `plan-no-scope-qualifier`. Same
product, same shared scheme, same consequence, and the goals differ only by the
phrase "in this project". The first returns `partial`, the second `plan`. That is
discrimination on scope, not a reflex, and it is what settled a case this README
previously recorded as contested.

The last change did not move the headline, and that is the point: it converted
two silent wrong answers into correct ones that were already being counted
generously, while adding two outcomes the schema previously could not express.

Refusals were 4/5 correct: the planner declines and names the missing capability
rather than approximating it with the nearest control.

Two failures remain.

**`no-scheduling`** is the real one. "Remove contractor edit access next Monday"
produced an immediate uncheck with no mention of the timing. The change is
possible, only the schedule is not, so it silently performed a different action
from the one requested. That is a distinct category from "cannot be done", and a
copilot that quietly drops half a request is worse than one that refuses.

**`over-broad`** unchecks Browse projects for "remove all contractor
permissions". Arguable: the literal reading is what was asked. It is graded a
reject because rule 4 says take the narrowest action and the ambiguity was never
surfaced.

### Outcomes

`plan`, `partial`, `nothing_to_do`, `cannot`, with a `limitation` string and Zod
`.refine()` rules so an outcome cannot contradict its own payload.

`partial` is the one that earns its place. "Remove contractor edit access next
Monday" is possible except for the timing, and the failure it replaces was doing
it immediately while saying nothing, which looks like success. The panel renders
the limitation above the steps, before any Approve button.

### Known gaps

**Role guessing and checkbox clicking were a model ceiling, not a prompt
problem.** Both had survived several prompt revisions on `gpt-oss-20b`, appearing
roughly once per run each. On `gpt-oss-120b`, with the identical prompt, schema
and corpus, both went to zero occurrences across 13 scenarios. That is the
clearest evidence in this project that some failures are bought off with model
capability and some are not.

**What did not move:** `over-broad` reads "remove all contractor permissions"
literally and revokes Browse projects on both models. It is the only remaining
failure and the only genuinely arguable one, since the literal reading is what
was asked. A real Jira admin should settle it, not me.

**One case worth watching.** On 120b, `read-only-happy` returned `partial` rather
than `plan`, on the grounds that the goal says "in this project" while editing a
shared scheme affects four. The plan itself was identical to the correct one. I
accepted it: the scope qualifier genuinely is unmet, so this is a legitimate
partial rather than caveat-noise. But the risk with a more capable model is that
`partial` starts firing on every caveat and the banner degrades into wallpaper.
It fired twice in 13 here, which is not enough to tell calibration from luck.

### Showing the effect, not the action

A checkbox step used to be described by its name. `click` on a checkbox toggles,
so a plan that says "uncheck this" grants the permission instead whenever the box
was already clear, which is exactly the case where someone asks to remove
something that is already absent.

Two defences. The prompt and the schema now require `setChecked` for checkboxes
and say why. More importantly the panel computes what the step will actually do
from the observed state and shows it above the Approve button:

- `Will turn it off.`
- `Already off. This step changes nothing.`
- `This clicks a checkbox, which toggles it. It is currently off, so this will turn it on.`

The third case is the one that matters: the panel contradicts the plan's own
reasoning, in amber, at the moment of approval. That holds whether or not the
planner obeyed the rule, which is why it is the more valuable of the two fixes.
Verify all of them without an API call:

```
dev/harness.html?demo=toggle-risk&stage=edit-permissions
dev/harness.html?demo=noop-step&stage=edit-permissions
dev/harness.html?demo=partial
dev/harness.html?demo=nothing
dev/harness.html?demo=cannot
```

**Role guessing is intermittent.** Rule 1a (null the role for unseen elements) is
followed in most plans and ignored occasionally. It cost one scenario in an
earlier run and none in the last.
