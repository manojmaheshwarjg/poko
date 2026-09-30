# Contextual Copilot: V1 Plan

## Thesis

Heavy enterprise software needs two kinds of training: how to drive the product,
and the SME judgment to know what the right move is. A copilot that has learned a
product's UI and its logic can collapse both, and turn an untrained user into a
competent one.

Business model is B2B2B. The software vendor is the client, not the end user.
Onboarding a vendor = ingest their docs + build a UI map from recorded sessions.
Target: 3 weeks to cold start on the top workflows, self-healing from live
sessions after that.

Category: Digital Adoption Platform (WalkMe, Pendo, Whatfix), but AI-native.
DAPs are hand-authored tooltip scripts that break on every UI release. This
learns the product and reasons instead.

**Human-in-the-loop is the default.** The copilot suggests a UI action with its
reasoning and does not act until the user approves. Full autopilot is opt-in.

## V1 target: Jira free tier

Picked because the admin surface is a genuine SME domain (there are people whose
whole job is Jira admin), everyone in a demo room has personally been lost in it,
and the public corpus is large: Atlassian support docs plus Atlassian Community.

Not Google Drive: it needs no training, so a working copilot there proves nothing.

## The one workflow that must work

**"Let contractors view but not edit issues in this project."**

Four screens, roughly ten clicks, and the confusing part is structural: the split
between global admin settings and per-project settings is exactly what trips
people up. Copy a permission scheme, adjust Browse Projects vs Edit Issues on a
role, then associate the scheme back to the project.

Backups if that one goes badly:
- Automation rule that transitions to Done on PR merge, bugs only.
- Make a field required on the Bug screen only (screens and field configs).

## Architecture

Surface: Chrome extension, content script plus side panel. No partnership needed,
and it is literally the smart cursor.

Observe via the **accessibility tree**, not raw DOM and not screenshots. It is
semantic, it survives cosmetic redesign, and it is small enough to fit in a
prompt. Highest-leverage technical call in V1.

Six pieces:

1. **Observer** - screen signature plus a11y tree
2. **Docs index** - chunk and embed Atlassian docs and Community threads
3. **UI map** - screens, controls, transitions, derived from recorded sessions
4. **Planner** - intent + observation + map + docs, out comes a step plan with reasoning
5. **Presenter** - highlight the target element, show why, Approve / Skip / Explain
6. **Executor + logger** - dispatch on approve, re-observe, log every accept and reject

Known Jira-specific risk: heavy SPA, modals render in portals, the a11y tree gets
large. Expect to need scoping and pruning before it fits a prompt.

## Phases

**Phase 0 (days 1-3): close the loop with no AI at all.**
Extension, a11y reader, one hardcoded three-step plan, highlight, approve,
execute. The risky part of V1 is the loop, not the model. Building the brain
first is how people discover too late that the loop does not close.

**Phase 1 (days 4-7): swap in the brain.**
Replace the hardcoded plan with an LLM call over the live a11y tree plus docs
RAG. Generalizes to unseen requests on known screens. Build the eval harness
here, not in Phase 3, so the number is visible while the work happens.

**Phase 2 (week 2): the UI map.**
Record 20 sessions, build the map, feed it to the planner. Make the map earn its
place by measuring accept rate with and without it.

**Phase 3 (weeks 2-3): the expert eval.**
20 stuck-user scenarios pulled from Atlassian Community. An SME grades every
suggestion.

## The metric

**Share of suggestions an expert would accept unedited.**

Not "did it suggest something." Above ~70% and this is a company and the demo
sells itself. Below ~40% and docs-plus-UI-map is an incomplete hypothesis, which
means the missing piece is consequence modelling (what happens *after* the click,
which lives in incident reports and forum threads, not in docs or click traces)
and onboarding has to change shape.

## Open questions

- Who is the SME grader for the Phase 3 eval?
- Onboarding asks for "recorded sessions", but sessions have an inverted coverage
  curve: people record what they already know. Ask vendors for the support ticket
  corpus and implementation-team screen shares instead, since those are labelled
  stuck moments.
- Pricing has to key off vendor outcomes (activation time, PS cost, ticket
  deflection, retention), never per suggestion. If the product teaches, usage
  falls over time by design.
