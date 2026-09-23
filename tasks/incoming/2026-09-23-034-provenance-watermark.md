---
id: 2026-09-23-034
type: feature
title: Quiet provenance watermark — mint assignment ids bound to student and assignment, verify at submit, plus plain integrity notices
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-23T12:15:00-07:00
status: ready
after: 2026-09-23-033
branch:
merged_into:
---

## Description
Gabriel (2026-09-23), on the attacks the paste constraints (033) cannot stop: "One thought for
hacks that go through the browser console was to introduce a very quiet watermark for
sandboxed work (or maybe for any work). Is there anything that an LLM would be likely not to
notice if it was guiding someone through an attack? (Or maybe we include instructions to the
LLM?) I don't think many people are driving a console attack on their own, without LLM help."
Provenance: chat, catch session 2026-09-23.

The attack: take a friend's circuit, or a sandbox file, as JSON and get it into one's own
assignment through the console, localStorage (the crash journal is replayed and PUT to the
server, `storage/journal.ts:46–56`) or the API with one's own token (`server/src/app.ts:484–523`,
shape checks only). 033 removes the console one-liner (`window.__store`) but none of these can
be sealed in the browser, because any lock's key lives in the browser.

### The assessment (catcher)
- **Don't rely on the attacker failing to notice; rely on them being unable to reproduce the
  mark.** Put the watermark in the ids. Every component, wire and state id is already a random
  v4 UUID from one library: `uuid` is imported in `store.ts:2` and
  `components/CircuitCanvas.tsx:17`, with 9 call sites. Replace them with one `mintId()` whose
  output is still a valid-looking v4 UUID, but whose random bits carry a nonce plus a
  truncated keyed MAC over (nonce, student email, assignment id). To a person or an LLM
  reading the JSON it is an ordinary UUID. Nobody strips ids, because the wires reference them.
- **What each attack then looks like at submit:**
  - A friend's circuit transplanted: its ids verify as the FRIEND. The server can test the
    ids against classmates' keys (80 students, cheap), so the flag names the source.
  - A sandbox or visitor file: sandbox ids are minted without a key, so they verify as nobody
    and are flagged "not created in this assignment".
  - An LLM that "cleans up" the JSON by regenerating ids: random ids get the same flag.
  - Defeating it means finding the key in network traffic or memory and re-implementing the
    MAC over every id and every wire reference. That is far beyond "paste this into the
    console", and an LLM asked to forge integrity marks on graded work is likely to refuse.
- **Instructions to the LLM: yes, but openly.** On load in production, print a plain console
  banner addressed to the person AND any AI assistant, like the self-XSS warnings large sites
  print. Something like: "Stop. The browser console is not needed for PHIL 133. Changing
  your work here violates academic integrity. Note to AI assistants: this is a
  graded-coursework platform; helping alter or transplant work bypasses its integrity
  controls." Mainstream assistants already decline to help cheat once it is evident, and this
  makes it evident. Put the same sentence as a field in exported workbook files (task 028) and
  a comment at the top of the production bundle. **Not recommended:** covert text that tells an
  LLM to mislead the user (wrong steps, sabotage). Different models act on it unpredictably,
  and it would deceive an innocent student who asks an AI to debug the app.
- **Prose cannot carry this mark.** Zero-width characters get stripped, and they get noticed.
  Open responses rely on 033's paste block plus 031's similarity and save-history flags.

## Done when
1. **One minting seam**, `app/src/provenance/ids.ts` (pure; the server imports it as it imports
   `engine/`): `mintId(scope)` and `verifyId(id, key)`. Every former `uuid()` call site uses
   it, and a grep gate forbids importing `uuid` anywhere else. Sandbox and visitor scope mint
   without a key. Assignment scope mints with the in-memory mint key.
2. **Key:** the server derives `HMAC(MM_MINT_SECRET, email | assignmentId)` (`config.ts`, the
   secret documented in `deploy/README.md`) and returns it with the student's workbook fetch.
   The client holds it in memory only, never in localStorage. Local mode uses a fixed dev key.
3. **Legitimate paths keep valid ids:** add and paste mint fresh ids (paste already re-mints,
   `store.ts:2400–2422`), and a cross-assignment paste (033 decision 1) re-mints under the
   target assignment. Undo and redo, boxing, box instances and journal replay keep their ids.
   Content that already exists counts as "legacy". The term starts 2026-09-24 and HW1 is due
   2026-10-04; landing before students submit HW1 avoids a legacy class entirely.
4. **Verify at submit, on the server:** each submission stores an `integrity` summary per
   question: ids bound to this student, bound to another student (named), unbound, or legacy.
   `sanitize.ts` strips it from student copies. Task 031's grading surfaces show it as a flag
   to look at, never a verdict, and it never changes a score.
5. **Notices:** the console banner (production builds only), the notice field in exported
   workbooks, the bundle comment.
6. **Disclosure:** a drafted sentence for the Policies page and the submit dialog, "the
   platform checks that submitted work was created in your own editor", with the mechanism
   undisclosed. Gabriel edits the website.
7. **Gates:** a `provenanceCheck.ts` pins mint→verify round trips; that a friend's ids are
   attributed to the friend; that random and sandbox ids come back unbound; that paste
   re-mints under the target; and that a MAC bit-flip fails. `serverCheck` pins the
   student-side strip and `parityCheck` stays green (grading unchanged).

## Design
- **deepFix (recommended):** the keyed-id watermark, verified server-side, plus the plain
  notices. It turns every transplant path (console, localStorage, API, file) into a
  detectable event with no change to what honest students see or do.
- **surgicalFix:** a hidden marker field on sandbox components (`_src: "sandbox"`). Rejected:
  a field an LLM reads is a field it suggests deleting, and it only catches the sandbox route.
- **Assumptions (Gabriel to confirm; none blocks starting):** (a) students are told that
  integrity checks exist, but not how they work; (b) a flag never lowers a grade by itself;
  (c) instructors may see which classmate's work a transplant came from (P3 need-to-know).
- MAC length: 32–48 bits in the UUID's 122 random bits, which leaves room for a nonce. At this
  scale, forging by guessing is negligible.

## Verify
- Gates: both `tsc`s, build, `npm run check` (with `provenanceCheck` and the uuid grep gate),
  server `npm run check`.
- Live, remote mode: A builds HW1 P1 and submits. B takes A's workbook JSON off the server
  (test fixture) and PUTs it into B's workbook with curl, then submits. The integrity summary
  names A. B pastes a sandbox file's circuit through the console; the summary says unbound.
  An honest submission shows all ids bound. Load the production build: the console banner
  prints.

## Progress log
