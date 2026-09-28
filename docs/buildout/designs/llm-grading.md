# LLM Grading: Suggestions a Human Confirms
_Status: proposed · 2026-09-27 · Task: 2026-09-21-014 · Builds on: `grading-interface.md` (accepted;
§4.2 precedence, §6.4 queue, §7 data layer, §9 P3) · Decisions owed: §9_

## 1. Problem family

Some of the course's gradable work is free prose: no bank, no codec, no string compare. Today
each such answer comes back from the grader `'pending'` (`engine/grader.ts`), counts 0 with the
grade marked provisional (`grading-interface.md` §4.2 item 3), and waits for a person in the
hand-grading queue (task 066).

**Instances (repo content, 2026-09-27).** 24 free-text `open` questions across HW1–HW7:

| HW | 1 | 2 | 3 | 4 | 5 | 6 | 7 | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| open questions | 10 | 4 | 3 | 2 | 2 | 2 | 1 | **24** |

HW1's 6 fill-in questions are out of scope: `engine/fillIn.ts` already grades them. With about 80
students, that comes to roughly 1,900 prose answers a term, about 800 of them in HW1.

**Wanted.** Gabriel wants these "passed through the LLM for grading" (task file, resolved
2026-09-25). He has already settled three things: batch by problem, send anonymous ids, and give
each gradable part its own field. **The tension:** the published Policies page says paragraph
answers are graded by a human, and that machine problems are graded by computer "not with AI".
Whatever gets built has to stay honest to whatever that page ends up saying (§9).

## 2. The current seam (corrected from the task file)

The task file describes the seam as "`applyManualReview` + a `source: 'llm'` marker on the
review". **That note is out of date.** Task 063 retired writes to `ManualReview`: `types.ts`
marks it `LEGACY`, and it is read only by the one-time migration. The live seam is:

- **`HumanGrade`** (`types.ts`): `{questionId, points 0|½|1, note?, answerKey, gradedAt,
  grader, attempt, version}`, stored in the `grades` table (PK assignment, student, question;
  the row is JSON with a `version`). Every change goes to the append-only `grade_events`.
- **`planGradeWrite`** (`storage/gradeWrites.ts`) is the one pure write planner, shared by the
  local store and the server. A stale `version` → conflict (409). It anchors the grade to the
  latest answer's `answerKey`, stamps the grader, and emits one `GradeChangeEvent`.
- **Precedence** (`engine/score.ts`, memo §4.2): a human grade whose `answerKey` matches wins.
  Otherwise the autograde applies. Otherwise the problem is pending.
- **The queue** (066): the feed `GET …/questions/:qid/responses`, keys `0` / `h` / `1`, Save &
  next, soft 5-minute claims (`gradingClaims.ts`), and Hide names.
- **`GradingStore`** (`storage/gradingStore.ts`), exported only by `backend.ts`. Its remote
  implementation calls `api/client.ts` and imports nothing from the grader (`remoteStoreCheck`).

This design fits against that seam.

## 3. Options

**A. The LLM writes a `HumanGrade`** (with `grader: 'llm'`, or with a `source` marker).
- *Captures:* the least new code, since score, release and export all work unchanged.
- *Leaves:* a machine verdict inside the table the memo calls "the human grade". Precedence
  would make it final the moment it lands. It contradicts the published policy. Every surface
  would need a `grader === 'llm'` special case, and P3 access accounting would show an actor
  that isn't a person.

**B. A separate suggestion record that a human confirms.** *(Recommended.)*
- *Captures:* a machine drafts, and a person decides. The draft lives in its own table and
  never enters precedence. Accepting it is an ordinary `planGradeWrite` under the confirming
  instructor's name. The grades table stays truthful, and the policy can be kept with a
  one-line rewording (§9).
- *Leaves:* one click per answer. A **bulk accept** (below) removes most of that click cost
  without changing the model.

**C. No LLM.** The queue as built (066) stays: 0 / h / 1 by hand, about 1,900 decisions a term.
- *Captures:* zero new risk.
- *Leaves:* the grading load Gabriel wants relieved.

**B covers A's product later without A's data model.** An "Accept all suggestions for this
problem" action is N ordinary grade writes, each by the instructor who clicked, and each
logged. If Gabriel decides the LLM's verdict should be final, that button is the whole
feature. The record still says a person accepted it, which stays true.

## 4. Decision

**Build B, suggestion-only, with bulk accept.** This is `grading-interface.md` §10's standing
line ("a suggestion a human confirms, never a grade"), and it keeps the published policy true
under the §9 wording. §4.2 precedence is **unchanged**, and `engine/score.ts` never reads a
suggestion.

### 4.1 Data model

A new server table. Local mode mirrors it in localStorage behind the seam, as §7.1 of the
grading memo does for `grades`:

| Table | Columns | Notes |
| --- | --- | --- |
| `grade_suggestions` | assignment_id, email (account key), question_id, suggestion JSON, batch_id | PK (assignment, student, question): the latest suggestion wins and **replaces** the earlier one (a replaced suggestion is not kept; the batch's `suggestion_runs` row records that it ran). The JSON is `GradeSuggestion`. |
| `suggestion_runs` | batch_id, assignment_id, question_id, actor, at, model, prompt_version, suggested, skipped, failed | One row per batch: the run's own log (it judges no one student, so it is not a `GradeChangeEvent`). |

```ts
/** A machine-drafted grade awaiting a person (task <follow-up>). Instructor-only; never read
 *  by engine/score.ts. */
export interface GradeSuggestion {
  questionId: number;
  points: Points;               // 0 | ½ | 1
  rationale: string;            // one or two sentences, shown in the queue chip
  answerKey: string;            // the answer it judged (score.ts answerKey): stale if it moved
  attempt: number;
  model: string;                // the provider's model id, as sent
  promptVersion: string;        // e.g. 'open-v1' (the prompt lives in the repo)
  batchId: string;              // one run = one problem × one click
  createdAt: string;
}
```

- Local key: `mm:grade-suggestions:<asgId>`, next to `mm:grades:`.
- **A run is logged in `suggestion_runs`, not in `grade_events`.** `GradeChangeEvent` requires a
  `student`, and its `before`/`after` are grade-shaped, so a batch summary does not fit it. There
  is **no** `'suggest'` event kind. Suggestions are drafts, not grades, and a replaced draft is
  simply gone. Its batch row says that a run happened, by whom, with which model, and how many
  answers it touched.
- `GradeChangeEvent.kind` gains only **`'accept'`**, with an optional `fromBatch?: string`.
  - An accept is the grade write's own event (per student and question, `after` = the
    `HumanGrade` written), so the log reads "P. Talma accepted suggestion batch X's ½".
  - Bulk accept logs one `accept` per student, the same as N single accepts.
- **Staleness:** a suggestion whose `answerKey` ≠ the latest answer's is shown struck through
  ("answer changed since suggested"), exactly as §4.2 handles a stale human grade. It can't be
  accepted, and **the server enforces this**, not only the display (§4.2 Accept). Re-running
  replaces it.

### 4.2 The seam

`GradingStore` gains three methods:

```ts
suggestions(asgId, qid): Promise<GradeSuggestion[] | null>;   // or folded into responses()
runSuggestions(asgId, qid): Promise<SuggestionRunSummary | null>;
acceptSuggestions(asgId, qid, picks: {studentKey, batchId, answerKey,
                                     version: number | null}[]):
  Promise<GradeWriteOutcome[]>;                                 // 1 pick = the 'a' key
```

- **A pick names the suggestion the instructor saw**: its `batchId` and the `answerKey` it
  judged, besides the `HumanGrade` `version`. `version` alone is not enough, because
  `planGradeWrite` anchors the write to the **latest** answer at write time.
- **Accept refuses, 409-style (`suggestion-stale`), per pick**, unless all three hold:
  - the stored suggestion for (student, question) still has that `batchId` (no re-run replaced
    it);
  - its `answerKey` equals the pick's;
  - and both equal `answerKey(question, latest record)` computed now.

  So a resubmission after the queue loaded, or another instructor's re-run, can never record
  points against an answer nobody saw judged. The refusal returns the current suggestion (if
  any), as the 066 queue's 409 returns the other grade.
- Only then does Accept reuse `planGradeWrite` with `write = {points: s.points, version}` and
  `actor = the instructor`. The optional note is empty: the rationale is **not** copied into
  the student-visible note (§6). A stale `version` is the usual 409.
- The check lives in one pure function beside `planGradeWrite` (`planSuggestionAccept` in
  `gradeWrites.ts`), shared by the local store and the server, so the two cannot drift.
- **The remote store** calls `api/client.ts` only. It is grader-free and provider-free, so the
  `remoteStoreCheck` grep gate holds (law 1).
- **Endpoints** (`requireInstructor`):
  - `POST /api/assignments/:id/questions/:qid/suggest`. Runs one batch and returns
    `{batchId, suggested, skipped, failed, model, promptVersion}`.
  - `POST …/questions/:qid/suggestions/accept`: `{picks}`.
  - The existing **responses feed** gains a `suggestion` field per row, so there is no new GET.

## 5. Where it runs

- **Server only.** A `SuggestionProvider` seam goes in `server/src/suggest/` with two
  implementations. The real one calls the model API, and a deterministic **fake** (points from
  a hash of the answer, rationale `"fake"`) drives the harness.
  - A config switch picks the provider: `MM_SUGGEST_PROVIDER = anthropic | bedrock | fake | off`,
    defaulting to `off`.
  - The key comes from env (`ANTHROPIC_API_KEY`, or AWS credentials for Bedrock), set in the
    Lightsail unit and kept in gitignored `secrets/`. `deploy/README.md` documents it.
- **Pure prompt building** goes in `app/src/engine/suggestPrompt.ts`: no DOM, no network (law 2).
  - It builds the request body from `(question statement, rubric, answers[{anonId, text}])`
    and parses the reply into `{anonId, points, rationale}[]`, dropping malformed rows.
  - The server imports it (as it imports the grader), and the harness pins it without a
    network.
- **When:** only when an instructor starts it, one problem at a time: "Suggest grades" in the
  066 queue header, or per row in the 065 Overview's problem table.
  - It is offered once the due date has passed. It **never** runs on submit, and never on a
    schedule.
  - A re-run replaces only suggestions that are stale or missing, unless "re-suggest all" is
    ticked.
- **Local mode** makes no LLM call and no `/api` call (law 5). `LocalGradingStore.runSuggestions`
  uses the same fake provider in-browser, so the queue UI is demoable and headless-testable.
  The button is labelled "(demo suggestions)".

## 6. How it is told apart from a human verdict (what the gradebook shows)

- **Points:** none. A suggestion never changes `scoreRecord`, the grade, provisional status,
  export, or release. Release still warns while any problem is pending, and a problem with only
  a suggestion **is** pending.
- **Queue:** a labelled chip over the response reads **"Suggested ½ — <rationale>"**, in its own
  muted style (never the grade colour), with "machine draft · batch X · model" on hover.
  - Keys `0` / `h` / `1` still set a grade directly, and the new **`a`** key accepts the chip.
  - The side list gains a "suggested" state.
  - The header has "Suggest grades" and "Accept all N suggestions…". The accept-all confirm
    names the count and says each will be recorded as the clicker's grade.
- **Matrix:** a pending cell with a live suggestion shows **✎·** (pending, suggestion waiting)
  and adds a filter chip "Suggested".
- **Overview:** a tile **"N suggestions awaiting confirmation"**, and a per-problem column
  "suggested x / y".
- **Submission page (067):** the chip sits beside the grade control, with an Accept button.
- **Students:** see **nothing**. Suggestions and rationales are instructor-only, like
  `integrity`.
  - `sanitize.ts` never serves them, and they are not on the record type students receive.
  - When an instructor accepts, the student sees an ordinary grade. They see a note only if the
    instructor typed one, and a rationale is never auto-copied into a note.

## 7. Anonymity, rubrics, injection

- **Anonymous ids.** Each request labels answers `r01…rNN`, numbered in a **freshly shuffled
  order per run**.
  - `public_id` is never sent: it is stable across runs and linkable to a person.
  - The map id → (student, question, part, attempt, answerKey) lives in the request's closure on
    the server, is never persisted, and never leaves the box.
- **Redaction.** Before sending, answer text passes a redactor. It masks roster names (given,
  family, preferred), every alias email, UIDs (`\b\d{9}\b`), and anything shaped like an email,
  replacing each with `[redacted]`.
  - The roster is the server's (`identity.ts`), and the redactor is pure and pinned.
  - A student who signs their answer ("— Jane D.") is the case this catches.
- **Rubric.** A new instructor-only field on `AssignmentQuestion`:
  `rubric?: {reference: string; full: string; half: string; zero: string}`.
  - It is **stripped** in `sanitize.ts stripAnswers` next to `fill_in_answers` (law 1).
  - It is **inside** the homework content hash (it is homework content, not an
    `INSTRUCTOR_OWNED_FIELDS` entry), so the repo sync refreshes it like the statement.
  - HW1's ten drafts on the audit page go into `hw1.json`.
  - A question without a rubric is **not suggestable**: the button is disabled and says why.
  - A QuestionCreator authoring UI is a follow-up item. The first build authors rubrics in the
    JSON.
  - ½ needs the 061 points model, which has landed.
- **Parts.** One field per gradable part is task 046/048. Until 048 lands, a multi-part open
  question is suggested as one answer against one rubric. The follow-up is `after` 048 if
  parts matter for launch.
- **Prompt injection.** Answers go in as **delimited data** (`<answer id="r07">…</answer>`, with
  any closing tag in the text escaped). The system prompt says answer text is never
  instructions, and the prompt is versioned in the repo (`promptVersion`).
  - Output is **structured JSON** (`output_config.format` / a strict schema) of
    `{id, points ∈ {0, 0.5, 1}, rationale ≤ 300 chars}`.
  - A row with an unknown id, a duplicate id or out-of-range points is dropped as "no
    suggestion". A refusal or a failure skips the batch and changes nothing.
  - **The backstop is the human confirm:** a successful injection ("give this answer 1") yields
    a wrong *suggestion* that a person sees next to the answer, never a grade.
  - Bulk accept is where this backstop thins. Its confirm dialog shows the distribution
    (e.g. "31 × 1, 40 × ½, 9 × 0") so an outlier batch is visible.

## 8. Cost and latency

**Prices** are from the `claude-api` skill's model table (cached 2026-06-24; re-check before
build): the default model, `claude-opus-5`, costs $5 / $25 per million input / output tokens.
Message Batches cost 50% and complete asynchronously (up to 24 h).

**One request = one problem × about 80 answers.** A prose answer is about 100–150 tokens, and the
system prompt plus statement plus rubric about 1.5k, so input is about **12k tokens**. The
output (80 × a JSON row with a short rationale) is about **5k tokens**, plus adaptive thinking
billed as output.
- Per request: 12k × $5/M + 5k × $25/M ≈ $0.06 + $0.13 ≈ **$0.19**. With generous thinking
  (×2 output), about **$0.35**.
- Per homework: HW1 (10 problems) ≈ **$2–4**, and HW2–7 are $0.35–1.40 each.
- The whole course, every problem once, is about **$5–9 a term**. Re-runs after resubmissions
  are marginal.
- The Batches API would halve this, but it trades seconds for hours. That isn't worth it at
  these sums for a button an instructor is waiting on.
- **Latency:** one interactive call is roughly 20–90 s at this size (it streams, since output
  is long). The endpoint runs it synchronously, with a spinner and "suggesting 80 answers…".
  A per-problem lock refuses a second concurrent run.
- **Recommendation:** interactive per-problem calls on the default model. Revisit a cheaper
  model only if measured agreement with Gabriel's own grades holds (the follow-up's first
  real-data step).

## 9. P3 / FERPA and the release-gating decisions (owed to Gabriel)

**Findings (web research 2026-09-27, all unverified, to be confirmed with UCLA):**
- UCLA DTS's AI pages list enterprise-approved tools. AWS Bedrock models, **including Claude**,
  are on that list, but the pages say these tools are **not approved for P3/P4 data, including
  FERPA student education records**, and most are limited to P1–P2. Graded student work tied to
  a student is P3.
- Anthropic's commercial API terms (per Anthropic's docs and third-party summaries) say
  customer content is not used for training. API inputs and outputs are deleted within 30 days,
  and zero data retention is available by agreement.
- Sources: `https://dts.ucla.edu/initiatives/ai/faq`,
  `https://dts.ucla.edu/initiatives/ai/ai-use-recommendation-guide`,
  `https://platform.claude.com/docs/en/manage-claude/api-and-data-retention`.
- Nothing found establishes that anonymised, redacted answer text stops being P3. That call
  belongs to UCLA.

**What that means for the design:** the anonymity pipeline (§7) is necessary, but it may not be
sufficient. The provider seam lets the real provider be **Bedrock under a UCLA account** if
that is the route UCLA approves, instead of a personal Anthropic key.

**Decisions, each with a recommendation first:**
1. **Suggestion or final?** *Recommend suggestion-only*, with bulk accept as the "final" path,
   recorded under a person's name.
2. **Policies wording.** *Recommend:* "Paragraph answers are graded by a person, who may consult
   an AI-drafted suggestion. Machine problems are graded by computer, not with AI." This keeps
   the page true under B.
3. **Student disclosure.** *Recommend* nothing beyond the Policies page: no per-answer marker,
   since the grade is a person's.
4. **UCLA approval before the first run on real student data** (which service, which account,
   and whether redacted text is still P3). *Recommend:* required, and the follow-up ships with
   the provider `off` until Gabriel records the answer.
5. **Model.** *Recommend* the skill's default (`claude-opus-5`) until agreement is measured.

## 10. Blast radius (the follow-up's build)

- **Types:** `types.ts`: `GradeSuggestion`, `rubric?` on `AssignmentQuestion`, `'accept'` (with
  `fromBatch?`) on `GradeChangeEvent.kind`; `SuggestionRun` for the batch row.
- **Engine:** `engine/suggestPrompt.ts`, which is pure (build, parse, redact).
- **Storage:**
  - `gradingStore.ts`: the three methods, and the local mirror with the fake provider.
  - `remoteStores.ts` and `api/client.ts`: the endpoints.
  - `gradeWrites.ts`: `planGradeWrite` accepts `kind: 'accept'` and `fromBatch`; the new pure
    `planSuggestionAccept` (batch + answerKey check) runs before it.
- **Server:**
  - `db.ts`: `CREATE TABLE IF NOT EXISTS grade_suggestions` and `suggestion_runs`, additive with no data migration.
  - `app.ts`: the routes.
  - `suggest/` (provider seam: anthropic, bedrock, fake, off) and `config.ts` (the env).
  - `sanitize.ts`: `rubric` stripped.
- **UI:** the queue (chip, the `a` key, header buttons), the Matrix marker and filter, the
  Overview tile, the 067 chip. The rubric authoring UI is later.
- **Content and deploy:** rubrics in `hw1.json` (the audit drafts) and the rest as authored; the
  env in `deploy/README.md`.
- **Harness pins:**
  - `parityCheck` / `serverCheck`: a student copy has no `rubric`, and no student route serves
    a suggestion.
  - `scoreCheck`: a suggestion never changes `scoreRecord`.
  - `gradingViewCheck`: an accept is one `planGradeWrite` with grader = instructor. Bulk
    accept = N writes. A 409 on a stale version.
  - `gradingViewCheck` (`planSuggestionAccept`): a pick is refused with `suggestion-stale`, and
    nothing is written, when the latest answer's `answerKey` moved since the suggestion (a
    resubmission after load), when the pick's `batchId` no longer matches the stored one (a
    re-run), or when the pick's `answerKey` differs from the stored one. The same case runs
    against the real server in `remoteStoreCheck`.
  - `remoteStoreCheck`: the grep gate forbids `suggest/` and any provider SDK in the remote
    graph.
  - **Anonymity pin** (a new case in `gradingCheck` or `suggestPromptCheck`): the built payload
    for a toy roster contains no name, email, UID or `public_id`, ids are shuffled per run, and
    malformed or unknown-id rows are dropped.
  - `statementFormatCheck`: every rubric, where present, is well formed.

## 11. Follow-up (draft task file: the catcher files it; the robot may not mint ids)

```markdown
---
id: <minted by /catch>
type: feature
title: LLM grade suggestions in the hand-grading queue
priority: normal
size: large
requires: human
area: server
source: audit
created: <at filing>
status: blocked
after: 2026-09-21-048   # only if per-part grading must ship first; else omit
branch:
merged_into:
---

## Description
Build design memo `docs/buildout/designs/llm-grading.md` (task 2026-09-21-014): an
instructor-started, per-problem run drafts a 0/½/1 suggestion + rationale for every open
answer; a person accepts (the `a` key, or Accept all) through the existing grade write. Never a
grade by itself; students see nothing.

## Done when
- `grade_suggestions` + `suggestion_runs` tables + local mirror behind `GradingStore`
  (`suggestions`, `runSuggestions`, `acceptSuggestions`); endpoints per memo §4.2; the batch
  logged in `suggestion_runs`, each accept a `GradeChangeEvent` of kind `accept`.
- Accept picks carry `{batchId, answerKey, version}`; the server refuses (`suggestion-stale`)
  any pick whose suggestion was replaced or whose answer moved (pure `planSuggestionAccept`).
- `SuggestionProvider` seam (anthropic | bedrock | fake | off; default off); pure
  `engine/suggestPrompt.ts` (build, parse, redact).
- `rubric` on AssignmentQuestion, stripped from student copies, in the content hash; HW1's ten
  rubrics authored in hw1.json.
- Queue chip "Suggested ½ — …", `a` accepts, Accept-all with distribution confirm; Matrix ✎·
  + "Suggested" chip; Overview "N suggestions awaiting confirmation".
- Pins (memo §10): parity/server (no rubric, no suggestions to students), scoreCheck (no point
  change), gradingViewCheck (accept = one planGradeWrite as the instructor; `planSuggestionAccept`
  refuses a pick after a resubmission, a re-run, or an answerKey mismatch, nothing written),
  remoteStoreCheck gate, anonymity pin.
- Policies wording updated per Gabriel's answer.

## Design
Memo `llm-grading.md` §4–§8. deepFix: separate suggestion record + human confirm through
planGradeWrite. surgicalFix (rejected): write HumanGrade with grader 'llm'.

## Verify
Gates (PROFILE §6); the pins above; local-mode queue with the fake provider in the preview
(chip, `a`, accept-all). Real-provider run owed, not claimed, until UCLA approval.

## Questions
1. Suggestion-only (recommended) or final verdicts?
2. Policies wording: "paragraph answers are graded by a person, who may consult an AI-drafted
   suggestion" — OK?
3. Any student-facing disclosure beyond the Policies page? (recommend none)
4. UCLA approval: which service/account (Bedrock via UCLA vs Anthropic API), and is redacted,
   anonymised answer text still P3? Provider stays `off` until answered.
5. Must per-part grading (048) land first?
```
