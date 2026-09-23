export const meta = {
  name: 'mm-task',
  description: 'Work one Making Minds task end to end on its branch: plan, implement, gates, adversarial review, fix, checkpoint',
  whenToUse: 'The /work-loop session runs it once per claimed task — args {task, branch, repo, today, coauthor} (tasks/LOOP.md §3)',
  phases: [
    { title: 'Plan', detail: 'read-only: map Done-when to changes; stop if it needs Gabriel' },
    { title: 'Implement', detail: 'edit on the task branch, add the pin, fast loop green' },
    { title: 'Gates', detail: 'the full PROFILE §6 table by exit code, ≤ 2 fix rounds' },
    { title: 'Review', detail: 'two adversarial read-only lenses: Done-when, load-bearing laws + correctness' },
    { title: 'Fix', detail: 'fix the verified findings, re-run the gates' },
    { title: 'Checkpoint', detail: 'progress-log entry, commit code + log on the branch' },
  ],
}

// ---- args -----------------------------------------------------------------
const A = args || {}
const REPO = A.repo || '/Users/gabrielgreenberg/Programming/makingminds'
const TASK = A.task
const BRANCH = A.branch
const TODAY = A.today || '(date not passed — use `date +%F`)'
const COAUTHOR = A.coauthor || 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
// Answers to a previous run's needsGabriel (from Gabriel, or the loop session's call on a point the
// task file already settles). Non-empty → the Plan stop is lifted; resume with resumeFromRunId to
// replay the cached Plan.
const DECISIONS = A.decisions || []
if (!TASK || !BRANCH) throw new Error('mm-task needs args {task, branch}')
const TASK_ABS = TASK.startsWith('/') ? TASK : `${REPO}/${TASK}`
const DECISIONS_NOTE = DECISIONS.length
  ? `\nDecisions settled after planning (they override the plan and the task file's wording where they conflict;
reviewers: an item met per these decisions is met):\n${DECISIONS.map(d => `  - ${d}`).join('\n')}\n`
  : ''

// ---- shared context for every agent ----------------------------------------
const CONTEXT = `
You are one stage of the Making Minds task workflow (tasks/LOOP.md §3), working task file
${TASK_ABS} on branch \`${BRANCH}\` in the repo at ${REPO} (tasks/PROFILE.md §2 names an older
path — ${REPO} is the real one). Read tasks/PROFILE.md §6–§8 for the gates and the load-bearing
laws; the task file is the spec.

House rules (PROFILE §3):
- The checkout is live and shared. Before ANY write, confirm \`git -C ${REPO} branch --show-current\`
  prints \`${BRANCH}\`; if it doesn't, stop and say so in your result — never switch branches.
- Absolute paths for every edit. \`git -C ${REPO} …\`, never \`cd && git\`.
- Never commit on main, merge, push, deploy, or touch tasks/blocked/. Never \`git add -A\` / \`git add .\`.
- Modified or untracked files you didn't create are someone else's work in flight: don't stage,
  revert, or gate on them.
- Anything the task file says must stay out of git (e.g. student records) stays out of git, out of
  fixtures and out of every file you write.
- Read in slices (sed -n / grep first); never cat docs/HISTORY.md, tasks/log.md or a whole check tool.
`.trim()

// ---- schemas ---------------------------------------------------------------
const STR_ARR = { type: 'array', items: { type: 'string' } }
const GATE_ARR = {
  type: 'array',
  items: {
    type: 'object',
    properties: { name: { type: 'string' }, exitCode: { type: 'integer' } },
    required: ['name', 'exitCode'],
  },
}
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    doneWhen: {
      type: 'array',
      items: {
        type: 'object',
        properties: { item: { type: 'string' }, change: { type: 'string' } },
        required: ['item', 'change'],
      },
    },
    checkTools: STR_ARR,
    owedChecks: STR_ARR,
    needsGabriel: STR_ARR,
    plan: { type: 'string' },
  },
  required: ['doneWhen', 'checkTools', 'owedChecks', 'needsGabriel', 'plan'],
}
const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    changedFiles: STR_ARR,
    fastLoop: GATE_ARR,
    deviations: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['changedFiles', 'fastLoop', 'deviations', 'notes'],
}
const GATES_SCHEMA = {
  type: 'object',
  properties: { gates: GATE_ARR, allGreen: { type: 'boolean' }, fixes: { type: 'string' } },
  required: ['gates', 'allGreen', 'fixes'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          summary: { type: 'string' },
          evidence: { type: 'string' },
          verified: { type: 'boolean' },
        },
        required: ['file', 'line', 'severity', 'summary', 'evidence', 'verified'],
      },
    },
  },
  required: ['findings'],
}
const FIX_SCHEMA = {
  type: 'object',
  properties: {
    fixed: STR_ARR,
    skipped: STR_ARR,
    gates: GATE_ARR,
    allGreen: { type: 'boolean' },
  },
  required: ['fixed', 'skipped', 'gates', 'allGreen'],
}
const CHECKPOINT_SCHEMA = {
  type: 'object',
  properties: {
    commit: { type: 'string' },
    doneWhen: {
      type: 'array',
      items: {
        type: 'object',
        properties: { item: { type: 'string' }, met: { type: 'boolean' }, evidence: { type: 'string' } },
        required: ['item', 'met', 'evidence'],
      },
    },
    changedFiles: STR_ARR,
    summary: { type: 'string' },
  },
  required: ['commit', 'doneWhen', 'changedFiles', 'summary'],
}

const GATE_TABLE = `
The full gate table (PROFILE §6), each by exit code:
  1. app-tsc       — (cd ${REPO}/app && npx tsc -p tsconfig.app.json --noEmit)
  2. app-build     — (cd ${REPO}/app && npm run build)
  3. app-check     — (cd ${REPO}/app && npm run check)      [boots real servers — minutes; use a 600000 ms timeout]
  4. server-tsc    — (cd ${REPO}/server && npm run typecheck)
  5. server-check  — (cd ${REPO}/server && npm run check)
Run them one at a time (several boot servers on fixed ports). Report the exit code of the LAST run of
each. Deps missing → \`npm ci\` in that package (never commit lockfile churn).
`.trim()

const gatesObj = arr => Object.fromEntries((arr || []).map(g => [g.name, g.exitCode]))

// ---- Plan -------------------------------------------------------------------
phase('Plan')
const plan = await agent(`${CONTEXT}

STAGE: Plan (read-only — do not edit anything).
Read the task file in full and the code it points at. Produce:
- doneWhen: every "Done when" item (short name), each mapped to the concrete change that meets it
  (files, functions, schema/migration, UI).
- checkTools: the harness tool(s) to add or extend with a pin (app/tools/*Check.ts or server/tools/*),
  and what each pin asserts.
- owedChecks: visual/browser checks the loop session must do itself (route, what to look at), and
  anything owed to Gabriel (ssh, real data) — as recipes.
- needsGabriel: NON-EMPTY ONLY for product/UX/policy choices the task file does not settle, each
  answerable in a line with your recommendation first. Technical choices are yours: take the deepest
  fix the evidence warrants (PROFILE §1). If the task file already decides something, it is settled.
- plan: a concise implementation plan (≤ 60 lines) an implementer can follow cold — order of edits,
  pitfalls you spotted in the code, which law in PROFILE §8 each risky edit touches.`,
  { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA })

if (!plan) throw new Error('Plan stage returned nothing')
if (plan.needsGabriel.length && !DECISIONS.length) {
  log(`Plan needs Gabriel (${plan.needsGabriel.length} question(s)) — stopping before any edit.`)
  return {
    stoppedAt: 'Plan',
    needsGabriel: plan.needsGabriel,
    doneWhen: plan.doneWhen.map(d => ({ item: d.item, met: false, evidence: 'not started' })),
    gates: {},
    changedFiles: [],
    owedChecks: plan.owedChecks,
    summary: plan.plan,
  }
}
log(`Plan: ${plan.doneWhen.length} Done-when items; pins in ${plan.checkTools.join(', ') || '(none named)'}`)

// ---- Implement ----------------------------------------------------------------
phase('Implement')
const impl = await agent(`${CONTEXT}

STAGE: Implement. Make the edits in the main checkout on \`${BRANCH}\`. Do NOT commit (the
Checkpoint stage commits).
${DECISIONS_NOTE}
The plan (from the read-only Plan stage):
${plan.plan}

Done-when → change map:
${plan.doneWhen.map((d, i) => `  ${i + 1}. ${d.item} → ${d.change}`).join('\n')}

Pins to add/extend: ${plan.checkTools.join('; ') || '(choose the matching check tool)'}

Rules:
- Depth over patches (PROFILE §1), routed through the seams; keep the load-bearing laws (PROFILE §8).
- Match the surrounding code's style, naming and comment density.
- Add the pin(s): the harness is the test suite. A new check tool must be wired into its package's
  \`npm run check\` script.
- If what is built or how it works changes, update CLAUDE.md IN PLACE (the affected Part 1 status
  lines / Part 2 entries — replace, never append; trim an equal amount of stale detail). It must stay
  ≤ 40 KB: \`node ${REPO}/tasks/tools/check-budgets.mjs\` must exit 0.
- Fast loop until green: app tsc, server typecheck, plus the one or two check tools that pin this area
  (\`npx tsx tools/<name>Check.ts\` from app/ or server/). Report their exit codes as fastLoop.
- deviations: anything you did differently from the plan, and why. changedFiles: repo-relative paths
  you created or modified (never someone else's files).`,
  { label: 'implement', phase: 'Implement', schema: IMPL_SCHEMA })

if (!impl) throw new Error('Implement stage returned nothing')
log(`Implement: ${impl.changedFiles.length} files; fast loop ${impl.fastLoop.map(g => `${g.name}=${g.exitCode}`).join(' ')}`)

// ---- Gates ------------------------------------------------------------------------
phase('Gates')
const gates = await agent(`${CONTEXT}

STAGE: Gates. The implementation is in the working tree (uncommitted) on \`${BRANCH}\`.
Files changed by the implementer: ${impl.changedFiles.join(', ')}

${GATE_TABLE}

If a gate is red: diagnose it. If the cause is this task's change, fix it (same rules: absolute paths,
this branch only, no commits) and re-run the red gate(s). At most 2 fix rounds. If the cause is
unrelated to this task (pre-existing, environmental — say a port in use), say so precisely in \`fixes\`
with the failing output's key line, rather than patching around it. allGreen = every exit code is 0.`,
  { label: 'gates', phase: 'Gates', schema: GATES_SCHEMA })

if (!gates) throw new Error('Gates stage returned nothing')
log(`Gates: ${gates.gates.map(g => `${g.name}=${g.exitCode}`).join(' ')}`)

// ---- Review (two adversarial lenses, read-only) ---------------------------------------
phase('Review')
const DIFF_HOWTO = `See the change with \`git -C ${REPO} diff main -- <paths>\` (working tree vs main, uncommitted
included) and \`git -C ${REPO} status --porcelain\` for new files. Changed files: ${impl.changedFiles.join(', ')}`
const LENSES = [
  {
    key: 'done-when',
    prompt: `LENS: Done-when compliance. For every "Done when" item in the task file, decide whether the
change meets it AS WRITTEN — every clause, every named message/report string, every pinned assertion.
Each gap is a finding (file:line where the fix belongs). Also check that the new pin actually asserts
what the task names (a pin that passes trivially is a finding).`,
  },
  {
    key: 'laws',
    prompt: `LENS: load-bearing laws and correctness. Check the change against PROFILE §8 (answer keys never
reach students, engine purity, edit locking in store.ts, notation seam, local mode byte-identical, sim
reset, CLAUDE.md budget) and hunt real bugs: edge cases, wrong inputs, regressions in callers of any
changed function, data migrations on existing databases, security (injection, what the API returns to
which role).`,
  },
]
const reviews = await parallel(LENSES.map(l => () =>
  agent(`${CONTEXT}

STAGE: Review (read-only — do not edit files). Be adversarial: assume the change is wrong until the
code shows otherwise. ${DIFF_HOWTO}
${DECISIONS_NOTE}
${l.prompt}

Verify every finding before reporting it: read the code path, or run a quick throwaway repro (in the
scratchpad / with npx tsx -e, never by editing repo files). verified=true only when you confirmed it;
drop what you could not confirm rather than padding. Severity: blocker (breaks a law or a Done-when),
major (real bug), minor (real but small), nit (style). Return an empty list if nothing survives.`,
    { label: `review:${l.key}`, phase: 'Review', schema: REVIEW_SCHEMA })))

const findings = reviews.filter(Boolean).flatMap(r => r.findings)
const confirmed = findings.filter(f => f.verified && f.severity !== 'nit')
log(`Review: ${findings.length} findings, ${confirmed.length} verified above nit`)

// ---- Fix ----------------------------------------------------------------------------
let finalGates = gates.gates
let fixResult = { fixed: [], skipped: [], gates: gates.gates, allGreen: gates.allGreen }
if (confirmed.length || !gates.allGreen) {
  phase('Fix')
  const fx = await agent(`${CONTEXT}

STAGE: Fix. On \`${BRANCH}\`, uncommitted.${DECISIONS_NOTE} Fix these verified review findings (all of them unless one
is wrong on closer reading — then put it in \`skipped\` with why):
${confirmed.map((f, i) => `  ${i + 1}. [${f.severity}] ${f.file}:${f.line} — ${f.summary}\n     evidence: ${f.evidence}`).join('\n') || '  (none)'}
${gates.allGreen ? '' : `\nThe gates were not all green after the Gates stage: ${gates.gates.map(g => `${g.name}=${g.exitCode}`).join(' ')}; notes: ${gates.fixes}\nTry once more to make them green if the cause is this task's change.`}

Then re-run the FULL gate table and report the final exit codes.
${GATE_TABLE}`,
    { label: 'fix', phase: 'Fix', schema: FIX_SCHEMA })
  if (fx) {
    fixResult = fx
    finalGates = fx.gates
  }
  log(`Fix: ${fixResult.fixed.length} fixed, ${fixResult.skipped.length} skipped; gates ${finalGates.map(g => `${g.name}=${g.exitCode}`).join(' ')}`)
}

// ---- Checkpoint ------------------------------------------------------------------------
phase('Checkpoint')
const minorLeft = findings.filter(f => f.verified && f.severity === 'nit')
const cp = await agent(`${CONTEXT}

STAGE: Checkpoint. The task's code is in the working tree on \`${BRANCH}\`, uncommitted.${DECISIONS_NOTE}
Final gates: ${finalGates.map(g => `${g.name}=${g.exitCode}`).join(' ')}
Review findings fixed: ${fixResult.fixed.join(' | ') || '(none)'}
Review findings skipped: ${fixResult.skipped.join(' | ') || '(none)'}
Nits left alone: ${minorLeft.map(f => `${f.file}:${f.line} ${f.summary}`).join(' | ') || '(none)'}
Owed checks (the loop session does these): ${plan.owedChecks.join(' | ') || '(none)'}

1. Judge each "Done when" item of the task file against the change as it now stands: met true/false
   with one line of evidence (file:line, check-tool pin, or gate).
2. Append a dated entry under \`## Progress log\` in ${TASK_ABS}, headed \`### ${TODAY} — implemented
   (work loop)\`: what was built (a few lines, plain language first), the pins added, gates by exit
   code, review findings fixed/skipped, what remains (owed checks), and THE EXACT NEXT STEP (normally:
   "loop session: visual check if owed, then land per PROFILE §5"). Keep it compact. Do NOT change the
   frontmatter status or move the file — landing does that.
3. Commit the code + the task file on \`${BRANCH}\` (confirm the branch first): \`git -C ${REPO} add\`
   with the explicit paths you and the earlier stages changed (${impl.changedFiles.join(', ')} plus the
   task file, plus any file the fix stage touched — check \`git status --porcelain\` and take only files
   this task changed). Message: a one-line summary starting with the task number (e.g.
   "035: …"), a blank line, a short body, then a blank line and exactly:
   ${COAUTHOR}
4. Return the commit sha (\`git -C ${REPO} rev-parse --short HEAD\`), the doneWhen judgements, the
   committed files, and a 3–6 line summary.`,
  { label: 'checkpoint', phase: 'Checkpoint', schema: CHECKPOINT_SCHEMA })

return {
  stoppedAt: null,
  doneWhen: cp ? cp.doneWhen : plan.doneWhen.map(d => ({ item: d.item, met: false, evidence: 'checkpoint failed' })),
  gates: gatesObj(finalGates),
  changedFiles: cp ? cp.changedFiles : impl.changedFiles,
  owedChecks: plan.owedChecks,
  needsGabriel: [],
  review: {
    findings: findings.length,
    fixed: fixResult.fixed,
    skipped: fixResult.skipped,
    nits: minorLeft.map(f => `${f.file}:${f.line} ${f.summary}`),
  },
  deviations: impl.deviations,
  commit: cp ? cp.commit : null,
  summary: cp ? cp.summary : impl.notes,
}
