# Self-learning onboarding: design

## The goal

Onboarding a product should be one manual step: point at the docs and the app.
Everything after that is learned from use. The system watches real sessions,
discovers the product's screens and the routes between them, writes its own
description of each route, proves that description is correct before trusting it,
and keeps itself current as the product ships. Nobody authors walkthroughs.

## What "fail-proof" means here

No system that uses a model can promise it is never wrong. This one promises it
**never fails silently**. Each guarantee below is enforced in code and has a test.

| # | Guarantee | Enforced by | Tested by |
|---|---|---|---|
| G1 | Nothing acts on the product without a human approving that step | runner: act only from approve() | existing loop |
| G2 | Nothing learned is used until it has passed verification | promotion gate: only `verified` routes reach the planner | learn tests |
| G3 | Nothing sensitive leaves the browser in clear text by default | redactor: hash-by-default, clear only for proven-safe labels; typed values never sent | redactor tests |
| G4 | The server re-checks what the browser sent | ingest re-applies PII patterns and drops values | ingest tests |
| G5 | Learning never acts on the product | capture is passive and humans drive; exploration only opens links that pass the link rules, in a sandboxed frame, and never clicks, types or submits | link-rule tests, mutation, live sandbox check |
| G6 | The system learns only from humans, never from itself | mining uses `source: user` transitions only | mining tests |
| G7 | A learned route that fails in use is demoted automatically | repair or rejection on a promoted route demotes it | feedback tests |
| G8 | Every step that came from a learned route checks it is on that route's screen before acting, and refuses if the check cannot run | runner hashes the live page and compares it to the screen's distinctive keys | parity + screen-check tests, live in the harness |
| G9 | Learning can only add, never subtract | eval runs with and without learned knowledge; a regression holds back the routes offered where it happened, and only a clean comparison that included them releases them | G9 tests + mutation, first run live |
| G10 | Capture failures never affect the user | recorder and uploader swallow their own errors; bounded queues | recorder tests |
| G11 | Every claim on the coverage page is backed by a stored record | coverage reads verification rows, never estimates | coverage page |

G6 matters more than it looks. If the system learned from the copilot's own
actions, a wrong plan that a user approved once would be mined as a workflow,
promoted, and suggested again: a feedback loop that entrenches its own mistakes.
Copilot transitions are recorded, but only as evidence for and against routes that
were learned from humans.

## Architecture

```
BROWSER (extension, or the dev harness)
  observer ─────► recorder ─► redactor ─► uploader ──────────────┐
     │            (passive: every user action becomes             │
     │             before-screen, action, after-screen)           │
  runner ◄─── plans ◄──────────────────────────────┐              │
  journal (decisions) ─► uploader ─────────────────┼──────────────┤
                                                   │              │
SERVICE                                            │              ▼
  /api/plan, /api/repair  ◄── known routes ◄── knowledge     /api/ingest
                                                   ▲         (re-redact,
  LEARNING PIPELINE (batch, re-runnable)           │          validate,
    1. screens   cluster observations into screens │          store)
    2. graph     transitions become edges          │              │
    3. mine      frequent routes + struggle points │              ▼
    4. label     the model describes each route    │          SQLite
    5. verify    the planner must reproduce it ────┘
    6. decay     unseen edges and routes fade
  /coverage   what is known, what is verified, where it struggles
```

## Privacy model

Two capture modes, chosen per install.

**Vendor mode** is for the vendor's own demo tenant, with explicit consent. Control
labels are sent in clear so learning is fast. This is onboarding.

**Customer mode** is for production use. Every label is hashed with a per-product
key unless it is provably a UI label: an interactive control or heading, outside a
content region such as a table cell or article, short, and matching none of the
personal-data patterns. When unsure, hash. The server learns structure over hashes
and the browser resolves them locally by hashing what is on screen, so a learned
route can still be replayed without its labels ever leaving the browser.

In both modes: typed values are never sent, URLs are normalised in the browser
(query strings dropped, ids replaced) before they leave, and the server applies
the same checks again on arrival.

Planning is different. When a user types a goal and presses Plan, the live screen
is sent to the planner in clear, because the model has to read it. That is a
per-request, user-initiated transmission and must be disclosed as such. It is not
the same as background capture.

## The learning loop

1. **Screens.** Observations are clustered into screens using a normalised URL
   pattern plus a weighted overlap of the controls present. Controls that appear on
   every screen (a global nav) are down-weighted automatically, so they cannot make
   two different screens look alike. The dev fixture marks each screen with
   `data-screen`; clustering never reads it, and it is used only to score clustering.
2. **Graph.** Each transition becomes an edge: screen, action, resulting screen, with
   a count and a last-seen time.
3. **Mine.** Episodes are cut from traces. Repeated paths become candidate routes.
   Backtracking, loops, abandonment, repairs and rejections are recorded as struggle
   points: the places users need help, which is worth more than the places they do not.
4. **Label.** The model writes a goal for each candidate route from its steps and the docs.
5. **Verify.** The planner is given that goal and the route's starting screen, cold.
   If its plan reproduces the observed route, the route is verified. If not, it is not
   used, and the mismatch is recorded as a gap.
6. **Use.** Verified routes are offered to the planner as known workflows: hints,
   not overrides, so a stale route cannot force a wrong plan.
7. **Demote.** A promoted route that needs a repair or is rejected in use goes back
   to unverified.
8. **Decay.** Evidence older than a configurable window (90 days by default) stops counting
   for edges and routes, and a route nobody has taken within it goes stale, so the model of
   the product tracks its releases. (Built in Phase J as a window, not a gradual fade.)

## Phases

| Phase | Builds | Verified by | Needs model calls |
|---|---|---|---|
| A **done** | recorder, redactor, uploader, SQLite store, `/api/ingest` | unit tests + driving the fixture and inspecting what was stored | no |
| B **done** | screen clustering, transition graph, `/coverage` | clustering scored against the fixture's `data-screen` ground truth | no |
| C **done** | episode cutting, route mining, struggle detection | synthetic traces with known answers + fixture traces | no |
| D **done** | labelling, verification by replay, promotion | run on the synthetic product: 4 of 4 routes verified | yes |
| E **built** | planner uses verified routes, expected-screen check, demotion | eval with and without learned knowledge (G9) | yes, to run the eval |
| F **done** | docs ingestion from a URL, coverage dashboard | local docs fixture (a public docs site not yet: it fetches a third party's site) | no |
| G **done** | read-only exploration by URL, opt-in, vendor mode only | link rules + mutation; live on a fixture with hostile pages | no |
| H **built** | scope-aware offering: no route for a request it cannot keep to | unit tests on the eval's own requests | yes, to prove it (G9) |
| I **built** | verification waits out per-minute limits, stops at a daily one | unit tests with fake rate limits | no |
| J **built** | decay: evidence outside a window stops producing routes | unit tests | no |
| K **built** | live spotlight: the highlight follows its element, re-locates when lost | runner tests; tracking itself not run in a browser | no |
| L **built** | the copilot's own decisions uploaded as struggle signals | unit tests end to end | no |
| M **built** | vendor enrollment codes for real products | unit tests | no |
| N **built** | the extension captures and explores: background uploader, settings | syntax only; not loaded in Chrome | no |
| O **built** | onboarding console, one page per product | pages render; no form was submitted | its verification button is paid |

## Open risks

- **Screen identity is the linchpin.** If clustering merges two screens or splits one,
  everything built on the graph inherits the error. That is why it is scored against
  ground truth rather than eyeballed.
- **Inverted coverage.** Usage mining learns what people already do well. Struggle
  points are the correction, and whether they are detectable enough is unproven.
- **Hash dictionary attacks.** A per-product key stops cross-product correlation, but
  anyone holding the key can test guesses against low-entropy labels. Acceptable for a
  prototype, not for production.
- **Verification is only as good as the replay.** Offline replay checks the plan against
  stored screens, not a live product, so it cannot catch a route that has since changed.
  Decay and demotion are the mitigation.

## Status

**Phase A is done.** Run `dev/test-all.sh` for the full verdict: 122 assertions
across the matcher, placement, redaction and ingest suites, plus syntax and types.

Verified end to end on 2026-09-24 by driving the fixture with `?learn=1`: one
approved plan step and four direct clicks produced exactly five transitions, the
approved step filed as `copilot` and the clicks as `user` (G6), the checkbox
recorded as checked before and unchecked after, and nothing in storage carrying a
typed value, a pixel rect or a query string (G3). Ten screen references deduped to
six stored observations.

Redaction is mutation-tested: nine deliberate breakages of its safety rules, from
dropping the personal-data check to letting the server trust the client, each fail
the suite.

Decisions taken while building, recorded here because they are not obvious from
the code:

- **Every label is always sent as a hash; clear text only when allowed.** Identity
  and graph-building run on hashes uniformly across modes, and a route learned in
  customer mode can still be replayed because the browser hashes what is on screen.
- **Personal-data patterns are absolute; the content-region rule is a heuristic.**
  k-anonymity (customer) or an explicit no-real-data attestation (vendor) may lift
  the region rule. Nothing lifts the patterns. Without this the fixture's permission
  checkboxes, which sit in table cells, would have been hashed in every mode and
  every learned route would have had a vague name.
- **A forbidden field is stripped, not fatal.** Rejecting a whole transition over a
  stray `value` is safe but throws away good data.
- **Privilege only ratchets down.** An install cannot move from customer to vendor,
  or gain an attestation, after first registration.

**Phase B is done.** 170 assertions across six suites. On live data captured from
two sessions through all six fixture screens (31 transitions, 10 distinct states),
clustering scored precision 1.000 and recall 1.000 against the fixture's
`data-screen` labels, which it never reads. A second run kept every screen id.

How screen identity works, and why:

- **Features are label hashes, never text,** so it behaves identically in vendor and
  customer mode. The main heading weighs most, content-region labels least, and a
  control's section is part of its identity (the Groq console had one button under
  four headings).
- **Global chrome is found two ways** (share of observations, and spread across a
  first-pass clustering) because each alone has a blind spot: the second catches a nav
  rail even when one screen dominates the traffic.
- **Data never splits a screen:** a content label seen in only one observation carries
  zero weight, since it can only dilute similarity.
- **Popups never split a screen:** menu items and options are weighted lightly, so an
  open menu is a state of its page. With no heading to anchor it, an open menu used to
  split off.
- **Average linkage, not single,** so two screens cannot chain together through a state
  that resembles both.
- **Different URLs never merge.** A slug the normaliser misses will over-split instead,
  and that is the intended trade: a split is the safe error.
- **A screen made only of global chrome is flagged `ambiguous`** and marked on the
  coverage page as not trusted for routes. Where two screens are genuinely identical,
  nothing could separate them; what matters is that the merge is never silent.
- **The correct threshold band is 0.2 to 0.8**, all seven tested values right, so the
  default of 0.5 is a design choice with margin rather than a lucky constant.
- **Ids survive re-runs** by matching member overlap: observations are content-hashed
  and immutable, so a screen is recognised by what it contains.

Clustering is mutation-tested too, and the first pass of that was the most useful
result of the phase: the suite was green but protected only 4 of 9 mechanisms, the
rest passing because other mechanisms covered for them on that data. Five targeted
tests later (data volume, cold start, chaining, sections, ties), 9 of 9 are caught.

**Phase C is done**, on synthetic data as agreed: 216 assertions across eight suites.
A behavioural simulator of the fixture generates real before/after screens for scripted
personas (efficient, lost, mistaken, two-change, reader, abandoner, dead-clicker), and
their sessions go through the real ingest, clustering and mining. From them the system
recovered the right routes and put the top struggle point on the Access-versus-Permissions
confusion the product docs warn about, without being told.

How mining works, and why:

- **Only human stretches are mined (G6).** An episode is split wherever the copilot acted,
  so no attempt can contain a copilot step. Eight copilot runs of a route add zero support.
- **Effects come from diffs, never from control names.** Screen changed: navigate. A popup
  appeared or left: open or close. A box flipped or a row appeared or vanished: mutate.
  Nothing changed: a dead click. `expanded` is a popup, not a change to the product.
- **An attempt is navigation then the change that was the point of it.** Several changes in a
  row on one screen are one task. A long pause or a new navigation after a change starts
  the next attempt.
- **Normalisation turns a messy attempt into the route it needed.** Undone changes cancel,
  dead clicks and peeks are cut, and detours back to a visited screen are unwound. Each cut
  is kept as a struggle signal. That is what lets the lost person and the expert count as
  evidence for the same route.
- **Canonical path is the one most people took**, then the shortest, then a stable order.
- **Promotion is gated:** a route through an ambiguous screen is blocked, and one with fewer
  than two attempts is blocked, each with the reason stated.
- **Verification is pinned to a path** (ready for Phase D). A verified or rejected route keeps
  that status only while its canonical path is the one that was checked; blocked by mining
  always wins; a route mining stops producing is kept as stale, not deleted.

Mutation testing found two more green-but-unprotected mechanisms, 13 of 15 caught at first:
nothing checked that dead clicks were cut from a route's path (which would have had the
copilot later suggesting a button that does nothing), and nothing checked which variant
became canonical. Both have tests now; 15 of 15 caught.

On the real fixture product, the only human evidence so far is four clicks, which produced
one route, correctly blocked as "seen 1 time, needs 2".

`node dev/seed-synthetic.mts` seeds a separate synthetic product (`http://synthetic.localhost`)
to see the coverage page populated; `--remove` deletes it again.

**Phase D is done.** Built with 40 assertions that exercise the whole flow with fake
models (including fakes that throw if they are ever called), then run once, with
permission, on the synthetic product on 2026-09-24. All four candidate routes verified:

| Route | The model's label | Planner, given only the label |
|---|---|---|
| untick Edit issues for Contractors | "Revoke the Edit issues permission for the Contractors role in this project" | exactly that change |
| untick Edit, tick Delete, for Contractors | "Remove the ability for Contractors to edit issues and grant Contractors the ability to delete issues in this project." | exactly those two changes |
| remove Developers from Access | "Revoke the Developers role's access to this project" | exactly that change |
| get to Permissions | "Show the current permissions for this project" | reached it through Permissions |

Nine calls were counted for eight that did work. The fourth route's label call hit Groq's
limit of 8,000 tokens per minute, and the run stopped as designed: the route was left a
candidate, the failure was recorded as a `skipped` verification row, and the three settled
routes were pinned so the re-run a minute later paid only for the fourth.

Running it also found a path bug: `lib/db.ts` and `lib/corpus.ts` fixed their paths from the
working directory when imported, and the scripts change into `service/` only after their
imports run. Started from the repo root, as documented below, verification opened a new,
empty database there instead of the service's. It made no calls (there was no product to
verify) and the stray file was removed; both paths are now resolved when used.

Each candidate route is labelled by the model (the request a person would type, as an
outcome, never as clicks), then the product's own planner is given only that label and
the route's usual starting screen, not the route, and its plan is compared:

- **verified:** exactly the route's changes, no more and no fewer. Mutations are compared
  strictly, including a checkbox's direction; navigation is only reported, as path
  agreement, since the learned route supplies the path anyway.
- **rejected:** anything else. The case this exists for: an over-broad label ("remove all
  contractor permissions") on a narrow route, which a faithful planner turns into an extra
  change, which is caught and named in the reason.
- **gap:** the planner says it cannot. People know how to do this and the docs do not
  cover it. A finding for the vendor.

Safeguards around cost, each tested:

- The default is a dry run that selects routes, shows exactly what would be sent and
  counts the calls. It never loads the model client or reads the API key.
- Real calls need `--confirm`, run under a hard budget, and never start a route that
  cannot be finished (a label nobody verifies is money wasted).
- A model error stops the run and leaves the route untouched. An outage says nothing
  about whether a label was right.
- A settled route is never paid for twice: verified, rejected and gap are pinned to the
  path they were checked on and only reopen if that path changes.
- A label describing clicks is rejected before paying to verify it.
- Routes whose labels are private (customer mode, not yet promoted) are skipped at no
  cost rather than labelled from hashes, and private labels never reach the planner.

Mutation-tested: 13 of 13 caught on the first pass.

```bash
node service/scripts/verify.mts http://synthetic.localhost             # dry run, free
node service/scripts/verify.mts http://synthetic.localhost --confirm   # 2 calls per unsettled route
```

**Phase E is built.** Verified routes reach the planner, learned steps check their
screen before acting, and routes that fail in use demote themselves. 286 assertions.

- **Offered, never imposed.** Only verified routes, and only the few that lexically match
  the request, go to the planner, in the user message (so they cannot break the cached
  prefix), as data. A static rule says to follow one only if it does exactly what was
  asked. The goal and the live screen always win.
- **Attribution has to be earned.** If the planner says it followed a route, its plan's
  changes are compared to that route exactly, the same comparison verification uses. A
  claim that does not hold is dropped, so a plan cannot borrow a route's credibility or
  its screen checks for something the route does not do.
- **Screen check (G8).** Each attributed step carries the distinctive keys of the screen it
  was learned on (never global chrome). Before acting, the page agent hashes the live
  page with the product key and compares. It fails closed: no key, no service, or an empty
  expectation means no action. A parity test proves browser and server compute identical
  keys in both privacy modes. Live in the harness, the same step, clicking a link present
  on every screen, ran on Board where it was learned and was refused on Access.
- **Demotion (G7).** A repair or a failed screen check demotes a route at once; skips need
  three, from at least two people; completions only count. A demoted route is sticky per
  path, so re-verification cannot promote it straight back to fail again.
- **Non-regression (G9).** `eval/run.mjs --origin <product> --compare` runs every scenario
  with and without routes and exits non-zero if learning made any scenario worse. Run
  once, and it failed: see below.

**G9 has been run, and learning regressed.** 2026-09-24, with permission: all 18 scenarios
with and without the synthetic product's four verified routes, 36 calls.

| | automatic checks passed |
|---|---|
| docs only | 17 of 18 (over-broad, the long-standing failure) |
| with routes | 15 of 18 |
| improved | none |
| regressed | read-only-happy, read-only-this-project-only |

Both regressions are the same mistake. The fixture's permission scheme is shared, so a change
"in this project only" means copying the scheme first; the docs say so, and docs-only planning
gets it right. The learned route is what people actually did (untick the box in the shared
scheme), and its verified label is "Revoke the Edit issues permission for the Contractors role
*in this project*". Offered that route, the planner:

- for "make contractors read only, but only for this project", dropped the Copy scheme path
  and followed the route's path into the shared scheme, then marked its own plan partial with
  the very caveat the docs-only plan had solved;
- for "let contractors view but not edit issues in this project", planned identical steps but
  dropped its "the scheme may be shared" caveat, because the label promised the scope.

The planner runs at temperature 0 and nothing else differed between the runs, so this is the
routes, not noise. And the label itself is the fault: "in this project" is a claim about
scope that the route cannot make, since the same clicks change every project sharing the
scheme. Verification could not catch it, because replay checks a label against the route's
changes and no one checks what the label promises beyond them.

**G9 is now enforced, and both causes are fixed** (473 assertions; 21 of 21 mutants caught):

- **Held routes.** `node service/scripts/g9.mts <eval results>` reads a with/without comparison
  (dry run by default, `--apply` to act). A regression holds back every route offered where
  planning got worse; one run cannot say which of them did the harm, so all are held. A held
  route is never offered in normal use and keeps its hold through learning runs while its
  path is unchanged. It gets one re-check with a fresh label after each hold, and stays held
  if it passes, because passing replay is what it had done before it made planning worse.
  Only a later comparison run with `--include-held`, with no regression and no unanswered
  scenario, in which the route was actually offered, releases it. The eval runner and the
  script share one verdict (`eval/compare.mjs`), so what is printed is what is enforced.
- **Labels may not promise scope.** The labeller is told never to claim a scope the route does
  not establish, and a free check rejects a change label that says "in this project", "just
  for this team" and the like before paying to verify it. A route that itself copies or
  creates the narrower thing may say so; a route that only goes somewhere may say where.
- **A workflow is a path, not proof.** The planner's rule on known workflows now says a workflow
  is not evidence of what its changes affect, that its label may promise more than its steps,
  and that what the docs say a change affects applies exactly as if no workflow had been
  offered. The list of workflows it is shown says the same.

Applied to the first run: the three routes offered in the two regressed scenarios are held
(the two contractor-permission routes and "Get to Permissions"); "Remove Developers", offered
in neither, stays verified.

**The second comparison did not clear them** (2026-09-24, with permission). The three held
routes were re-checked first (6 calls): all passed, and none of the new labels promises scope
("Remove the Edit issues permission for the Contractors role"). The comparison, run with held
routes included, then hit Groq's on-demand limit of 200,000 tokens per day after 11 answered
calls, so 17 of 18 scenarios are inconclusive and G9 released nothing, as it should. The
answers it did get are the finding:

- "read-only-happy" followed the route (attributed this time, the bracket fix working) and
  again dropped its "the scheme may be shared" caveat;
- "read-only-this-project-only" swung the other way and refused: "cannot determine whether the
  project's permission scheme is shared". The right answer copies the scheme first.

So the label's wording was not the whole cause. Offering a route that edits a shared setting
pulls the planner off the documented path for requests scoped to one project, whatever the
route is called and whatever the rule says. The routes stay held. The docs-only side of both
scenarios went unanswered in this run, and the planner's rules changed since the first run, so
their baseline has to be measured again too.

The runner now reads minute-long waits ("try again in 17m53s"), treats them as a daily limit,
and stops, keeping what it has, instead of retrying into the limit for twenty minutes.

Two bugs found in the process, both fixed and tested (441 assertions):

- **Attribution refused a faithful claim.** Workflows are shown to the model as `[r_...]`, and
  it copied the brackets into its answer, so a plan that followed an offered route was refused
  as "not offered". That failed closed, but it silently switched off the screen check and
  demotion for such plans. The claim is now unwrapped before the exact match.
- **An unanswered request could fake a regression.** One scenario needed its fourth and last
  retry to get past the rate limit; had it failed, it would have counted as a failure on one
  side only. Unanswered requests are now inconclusive and left out of the verdict, and the
  runner retries six times (rate-limited requests are not billed).

**Phase F is done.** `node service/scripts/ingest-docs.mts <start-url> --tool <name>` crawls
a vendor's docs into `service/corpus/<name>/web-*.md`, with `_sources.json` recording where and
when each page came from, and retrieval treats them like the hand-written files. 33 assertions.

- **Polite and bounded.** robots.txt is obeyed, and an unreadable one stops the crawl rather
  than being read as permission. Scope is the start page's directory on the same origin, with
  page, depth, size and delay limits.
- **Redirects are checked, not followed.** fetch follows redirects by default, and the tests
  caught an in-scope link redirecting to an out-of-scope pricing page being fetched. Redirects
  are now manual: a target in scope is queued, anything else is skipped and reported.
- **Navigation gives links, not text.** The extractor first dropped nav and aside entirely,
  which made a docs site's sidebar table of contents, and every page only it linked to,
  unreachable. Navigation, headers, footers and forms now contribute their links but none
  of their text.
- The coverage page has a **Documentation** section: what the corpus holds, and the docs gaps
  (routes people take that the planner could not reproduce from the docs).

Verified against the local docs fixture. It has not been run against a public docs site:
that fetches someone else's site, so it waits for a go-ahead and a choice of site.

**Phase G is done.** Read-only exploration maps a product's screens before anyone has used it
with the copilot, so the map does not start empty. 437 assertions across thirteen suites.

What it may do, and what stops it:

- **Opens links, nothing else.** Starting from the page the vendor is on, it loads `a[href]`
  URLs in a hidden frame and observes each page. It never clicks, types, submits or opens a menu.
- **Link rules** (`core/explore-rules.js`, shared by browser, tests and server): same origin,
  inside the scope, http(s), not the page itself, not a download, not wired to a non-GET method
  or a confirmation, no action parameter, and no word in the path, query or link text from a
  deny-list about sessions, secrets, money, deletion, sending and state changes. Words are
  matched with their inflections and split spellings (deletion, logOut, log-out), and the link
  text counts: an icon link to `/bye` labelled "Sign out" is refused. Ordinary list pages
  (releases, reports, applications) are deliberately not on it.
- **One page per URL pattern.** `/items/1` and `/items/2` are one screen; exploration finds
  screens, not records.
- **The frame is sandboxed** without forms, popups, modals, downloads or top navigation.
  Checked live with a fixture page that, only inside the explorer, tries all four on load:
  `window.open` returned null, `alert` returned at once, the form submission never reached
  the server, assigning `top.location` threw, and the page never took keyboard focus.
- **It stops** at the page limit, on the person's Stop, at a sign-in page (a visible password
  field means the session ended), and when a page lands on another origin (a sign-in redirect,
  or a product that refuses framing). A 404 is recorded as a failure and skipped.
- **Vendor mode only.** The server accepts explored pages only from a vendor install with the
  no-real-data attestation, and the privilege ratchet means an install cannot gain that later.
  Everything is re-checked on arrival as capture is (G4); reasons and words must come from the
  rules' fixed vocabulary; refused links are kept as patterns, other sites as origins only.

What it may teach: explored pages are observations, so clustering sees them and they become
screens, marked "found by exploring, nobody has used it yet" until someone does. They are never
transitions, so mining never sees them (G6): exploration shows what exists, never what people do.
A test mines the same human sessions with and without exploration and gets identical routes.

Live on the fixture site, one run opened exactly the ten pages the rules allowed and refused
nine distinct links (billing, sign out, export, watch, archive, delete, remove, a Rails-style
`data-method="delete"` link, unsubscribe). The site's server log shows no request for any of
them. Learning on the result gave twelve screens across both fixture runs with precision and
recall 1.00 against the fixture's labels, and no routes.

Mutation-tested: 29 breakages of the link rules, the server gate and the learning hook. 28
were caught on the first pass. The survivor was a test that looked like it checked fragment
stripping but never exercised it; it has a direct test now, and 29 of 29 are caught. The
browser-only mechanisms (sandbox, stop conditions, focus) are verified live, not by mutation.

Found by running it live, and fixed:

- **One install id per browser collided with one product per install.** The server ties an
  install to one product, so the second product a browser was used on had every upload
  refused. It failed closed (the run stopped with the server's reason), but capture had the
  same problem. Install ids and upload queues are now per product origin, which also means
  the server cannot link one person's use of two products, and a queued transition can never
  be flushed under another product's id.
- **Reports counted a nav link once per page** ("27 that could change something" for 9 links).
  Each skipped link is now counted once per run.
- **A stray reset four seconds after the harness loaded.** Its "already loaded?" check matched
  the stage's initial about:blank, messaged a page with no agent, and reset the runner when the
  message timed out. That would have wiped a plan started in the first seconds. Harness only.

**Phases H to O: filling the gaps before the next paid test** (2026-09-24). Built one after
another on the user's instruction to keep building and defer testing; no model call was made.
530 assertions across seventeen suites pass; what was not exercised is listed in the
known issues.

- **H, scope-aware offering.** The scope wording moved into one module (`lib/learn/scope.ts`)
  used on both sides of a route: its label may not promise a scope its steps do not establish,
  and a request that asks for one ("in this project", "only for this project") is not offered a
  route that cannot keep to it, unless the route itself copies or creates the narrower thing.
  The two G9 regressions came from exactly those requests; both would now plan from the docs
  alone, as they did before learning. The plan endpoint reports what it withheld and why.
- **I, rate limits in verification.** A refused request is retried after the wait the provider
  asks for and never counted against the budget; a daily limit ("try again in 17m53s") stops
  the run at once, saying so, with the route left as it was.
- **J, decay.** Learning runs use only evidence inside a window (`COPILOT_DECAY_DAYS`, 90 by
  default). Older transitions and decisions stay stored; routes that only they supported go
  stale, with the reason, and are no longer offered. Screens are kept.
- **K, live spotlight.** The highlight follows its element through scrolling, resizing and
  re-rendering; when the element is removed or hidden it comes down and the runner looks for
  the step again (at most about twice a second, never while acting). This closes the old
  "stale spotlight" issue.
- **L, the copilot's decisions as signals.** With capture on, each decision (approved, failed,
  turned down, repaired, not found, wrong screen) is redacted in the browser and uploaded: the
  goal, intent and reasoning never leave, because they are written from what the person typed.
  Learning places decisions on screens and shows the mistakes on the coverage page ("Turn down
  the copilot's suggestion ... on Edit permissions").
- **M, enrollment.** A vendor install of a product on a real web origin must present a
  one-time, expiring code issued for that product, stored only as a hash; without one the
  claim is refused before anything is stored. Local products stay exempt. The code is shown
  once on a page of its own, never put in a URL.
- **N, the extension.** The background worker now owns capture: an uploader per product using
  `chrome.storage`, fed by pages even when the side panel is closed, queues surviving the
  worker being stopped. The side panel follows the active tab's product, shows capture status,
  sends decisions, offers exploration to an enrolled vendor demo account, routes spotlight
  events, and has settings (capture off and customer mode by default, attestation, enrollment
  code, service address). The uploader was rewritten around asynchronous storage for this;
  the harness uses the same code with `localStorage`.
- **O, the onboarding console** (`/onboard`). Products, and for each: docs ingestion from a URL,
  browsers and enrollment codes, what has been captured, learning, verification (a preview of
  the routes and the exact call count, and a paid run only behind a ticked confirmation that
  is re-checked against the current plan), and the with/without verdicts with the held routes
  and an Apply button.

**Sekva: the console and the panel, rebuilt** (2026-09-25). The product is now called Sekva.
Coverage, the onboarding console and the result pages became one light-only console around
a map of the product, and the panel was redesigned. No model was called to build or test
any of it. 620 assertions across eighteen suites pass (`dev/test-console.mts` is new; the
runner suite grew from 7 to 19), and every page was checked in a browser on localhost.

- **The map** (`lib/console/layout.ts`, `model.ts`). Screens are stations in columns by the
  longest way in from where people start, with links that go back set aside first, so a rare
  shortcut becomes a line in the lane instead of dragging a deep screen forward. Heights are
  the closest to the screens that lead in that keep the order and the gap (isotonic regression
  by pooling adjacent violators). Lines are orthogonal and never cross a station. Each station
  is drawn from the roles of the controls it was seen to have, never a screenshot. Line counts
  are distinct people from real use only (G6). Layers: traffic, routes, struggles, docs,
  explored. Every number is read from a stored row (G11); the client computes none.
- **Where learning changed the plan** (`lib/console/evaluations.ts`). For a route a comparison
  tested, both plans of the most telling scenario (worse with the route, and the two plans
  going different ways) are walked over the links people use; a control never seen in use is
  reported as such rather than placed. On the synthetic product this reproduces the G9
  regression exactly: from Permissions, the docs-only plan uses "Copy scheme", which nobody
  has used, and the plan with the route goes straight to Edit permissions. Comparisons from
  before runs recorded their product are attributed by the routes they offered, and say so.
- **Paid runs are queued** (`lib/console/queue.ts`, `worker.ts`, `lib/usage.ts`). Every model
  call records the tokens the provider reported, against the queued run it belongs to when
  there is one (the eval marks its requests with the run). A paid action opens its exact
  call count, estimated tokens from the recorded average, what is left today and how long
  the per-minute limit makes it; it needs a tick; confirming queues it now or for 09:00 the
  next day. A queued run can be cancelled until it starts, refuses to start if it would now
  make more calls than were approved, and moves to the next morning if the day's spend grew
  and it no longer fits. The worker (started in `instrumentation.ts`) runs only queued runs,
  one at a time; a comparison applies its G9 verdict when it finishes unless told not to.
- **History, struggles, scenarios, gaps.** Route events (mined, status changes, stale, held,
  released, demoted) are recorded in the same transaction as the change; older routes fall back
  to what the route row and the verifications table already show. A struggle shows where those
  people went next and, for the copilot's own mistakes, what it proposed next to what the person
  did. A struggle becomes an eval scenario (written to `eval/scenarios.added.json`, which the eval
  now merges) or a docs gap note.
- **The panel.** Plan, Activity and Settings tabs; A approves, S skips, Cmd+Enter plans. A
  route-following plan shows its screens as a line of stops with where you are. A learned step
  now checks its screen before pointing, and on another screen offers "Take me there": the
  way from the current screen along links people use (`lib/console/wayfind.ts`, no model),
  menus opened first, private labels refused. Every step of the way only navigates, so one
  press covers them all; the step itself still needs its own approval, and being elsewhere is
  not recorded against the route (only a refused approval is). The spotlight caption says
  "Step 3 of 5" and "found again". Suggestions come from verified routes only.

A note on the mutation harness itself: it originally counted a mutant as caught only
if some assertion printed FAIL. A mutant that made the suite crash printed none and
was reported as surviving. It now counts a mutant as surviving only if the suite
still reports all passing. That made it stricter, not looser: no earlier "caught"
result depended on the old rule.

## Known issues

- **The console's paid path has not run for real.** The queue, the budget check and both
  executors are tested with fake executors only; nothing was queued in the dev database. The
  first real queued comparison is also the first end-to-end check of the job tagging.
- **The extension was not loaded unpacked for this round.** The side panel uses the same panel,
  runner and page agent as the harness, where the new flow was exercised (including Take me
  there on the mock), but the Chrome side panel itself was not opened.
- **Docs coverage is a whole-name text match.** "Mentioned in the docs" is exactly that.
- **Take me there needs clear labels.** In customer mode, before labels are promoted, a way
  through a private label is refused rather than guessed.
- **Phases H to O were built without the tests the user deferred.** Unit tests pass for
  everything that can run in Node. Not yet done: the with/without comparison that would prove
  H (and release the held routes), loading the extension in Chrome (N), exercising the
  spotlight tracking in a browser (K), and submitting the console's forms (O).
- **The service has no sign-in.** Anyone who can reach it can use the console: issue
  enrollment codes, ingest docs, apply G9 verdicts, and start a paid verification run (behind
  its confirmation). Fine on localhost; a deployment needs the product admin's sign-in first.
- **The scope filter cannot tell a per-project setting from a shared one.** A scoped request
  is not offered any route that changes something without copying or creating it, so it also
  loses routes that were in fact per-project (a project's Access list). That costs help,
  never correctness.
- **Exploration's deny-list cannot see intent.** A GET that changes state under an innocent
  name (`/items/7/x`) is opened. The sandbox, the vendor-only gate and the demo-tenant
  requirement are the backstops, and opening any page can still have what viewing it does:
  a notification marked read, a "last viewed" time.
- **Exploration needs the product to allow same-origin framing.** A product that sends
  `X-Frame-Options: DENY` stops the run at the first page with a clear reason. A background-tab
  mode for the extension would cover it and is not built.
- **Exploration misses what links do not reach.** Controls that navigate without an `href`
  (common in single page apps), and screens that differ only by query (`?tab=backlog`), are not
  explored: patterns drop the query, and exploration never clicks.
- **A password field ends a run.** An admin page with a "set password" field for a new user
  reads as a sign-in page and stops exploration early. Safe, but it can cut a run short.
- **Enrollment is only as strong as the console's access.** Vendor mode on a real product now
  needs a one-time code (Phase M), but the codes are issued by a console without sign-in, and
  the attestation that the account holds no real data is still the vendor's word.
- **The recorder snapshots synchronously on every click.** Cheap on the fixture and
  the Groq console; unmeasured on a page with tens of thousands of elements.
- **Clustering is O(n^3) in distinct observations** per URL pattern. Fine for hundreds;
  thousands will need leader clustering against screen prototypes.
- **URL slugs over-split.** `/projects/payments/settings` and `/projects/billing/settings`
  become two screens, because a slug is indistinguishable from a real path word. Safe,
  but routes learned on one do not transfer to the other.
- **No headless real app has been clustered live.** Headless behaviour is covered by
  synthetic tests only; the Groq console was observed, not captured.
- **Effect classification is untested on a noisy real app.** On the fixture a persistent
  change always means the person changed something. On a real product, a toast, a live
  counter or lazily loaded content would read as `mutate` and cut attempts in the wrong
  place.
- **Mining is validated on synthetic people only.** The simulator is faithful to the fixture,
  but personas are my guesses at behaviour, not observations of it.
- **A copilot decision is placed on a screen by URL and heading only.** Where two screens share
  both, it goes to the one seen most; where none matches it is counted but not shown. It also
  records only what the runner journals: a not-found that the person simply abandoned, without
  asking for a repair, leaves no decision.
- **A label can still promise more than its route does, in ways the checks do not see.** The
  scope check is a word list: it catches "in this project" and its kin, not every way of
  implying scope, and nothing checks promises about side effects. The with/without comparison
  is the backstop, and it only sees what the eval's scenarios exercise.
- **Holding is coarse.** Every route offered where planning got worse is held, including ones
  that did no harm, because one run cannot tell them apart. Releasing any of them costs a
  full comparison run.
- **A route that genuinely narrows scope without copying or creating anything** (say, a
  per-project override switch) would have its honest "in this project" label rejected.
- **Nearly every request is offered a route.** Lexical ranking offered at least one route on
  all 18 eval scenarios, mostly near misses, and near misses are what caused the regressions.
- **The planner's daily budget fits about one comparison.** Groq's on-demand tier allows
  200,000 tokens a day for this model; a planner call is about 3,700, so a full with/without
  comparison (about 133,000) leaves little for anything else that day.
- **Verification waits rather than paces.** It now waits out per-minute limits without counting
  the refused attempts (Phase I) and stops cleanly at a daily one, but it does not spread calls
  to stay under the limit, so a large product's run spends much of its time waiting.
- **The labeller and the verifier are the same model.** A label that model finds natural
  may replay cleanly partly because both calls share the same blind spots. A stronger check
  would verify with a different model, or put a sample of verified routes in front of a
  person who knows the product.
- **Verification replays against stored screens, not the live product.** It proves the
  label and the route agree; it cannot prove the route still works today. Decay and
  demotion (Phase E) are the mitigation.
