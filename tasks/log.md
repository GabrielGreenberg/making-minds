# log — one line per landed task (append-only; ≤ 300 chars per line — tasks/tools/check-budgets.mjs)

<!-- id · type · title · landed ISO · branch · last code commit sha -->
2026-09-21-001 · chore · Set up the task pipeline (catcher / work / worker) and shrink CLAUDE.md to an index · 2026-09-21T15:09:48-0700 · task/001-task-pipeline · a04f63f
2026-09-21-019 · feature · Restyle the administrative surfaces to be continuous with makingminds.org (student first, then instructor) — Phase A · 2026-09-21T16:31:22-0700 · task/019-restyle-admin-surfaces · c35a427
2026-09-21-021 · feature · Restyle the instructor views onto the page-surface design layer (019 Phase B) · 2026-09-21T20:56:28-0700 · task/021-restyle-instructor-surfaces · 060a3c8
2026-09-21-022 · chore · Retire the bundled assignment mechanism (drop cc-basics) · 2026-09-21T21:46:28-0700 · task/022-retire-bundled-assignment · 6b33798
2026-09-21-023 · feature · One page frame and a clear instructor navigation (Dashboard, tabs, role switch, Sandbox set apart) · 2026-09-21T21:59:30-0700 · task/023-instructor-navigation · 86f2761
2026-09-21-026 · feature · Give students a Home with Assignments · Grades tabs, an up-next box and a Grades page (retire the grade-sheet modal) · 2026-09-21T23:02:30-0700 · task/026-student-home-tabs · bd53ff4
2026-09-21-020 · feature · Render an assignment as a readable problem-set document modelled on the HW PDFs · 2026-09-22T09:55:39-0700 · task/020-problem-set-document-view · 5f8bb98
2026-09-21-007 · feature · Sync HW1–HW7 from the repo into the server database on every release · 2026-09-22T19:11:14-0700 · task/007-homework-sync · d1e3230
2026-09-22-027 · feature · Visitor mode — use the sandbox without signing in; unknown browsers land there, known ones sign back in · 2026-09-23T11:45:40-0700 · task/027-visitor-mode · b92c737
2026-09-23-035 · bug · Import the registrar's class list as exported — skip its preamble, read its columns and name format, leave out withdrawn students · 2026-09-23T14:34:45-0700 · task/035-registrar-roster-import · cde8684
2026-09-23-032 · bug · Scope editor state to its user and canvas — sign-out hands one user's work to the next; undo reaches across questions; one sandbox per person · 2026-09-23T16:27:08-0700 · task/032-scope-editor-state · 306691d
2026-09-23-033 · feature · Anti-cheating paste constraints — in an assignment, accept only content copied there in this window by this user; the sandbox stays free · 2026-09-23T17:36:42-0700 · task/033-assignment-paste-provenance · ee74c79
2026-09-23-034 · feature · Quiet provenance watermark for circuits and paragraphs — keyed ids and text stamps, a signed writing/build trace, verify at submit, plain integrity notices · 2026-09-23T19:03:27-0700 · task/034-provenance-watermark · e78764f
2026-09-21-002 · feature · Load a failed test input from the grade sheet into a live Run on the question canvas · 2026-09-23T20:21:14-0700 · task/002-failed-input-to-live-run · f511af7
2026-09-21-003 · feature · Let a student view a submitted snapshot read-only at any time, not only once past due · 2026-09-23T21:24:57-0700 · task/003-view-submission-mode · 6269f85
2026-09-21-004 · feature · Allow boxing a sequential (MEM-containing) sub-circuit on SC canvases · 2026-09-23T22:49:05-0700 · task/004-box-sequential-subcircuit · 2978b7b
2026-09-21-005 · feature · Author fill-in-the-blank questions in the question creator · 2026-09-23T23:24:21-0700 · task/005-fill-in-authoring-ui · 0a2e76e
2026-09-21-010 · feature · Author an arena family (several turbot_cases) in the question creator · 2026-09-24T00:04:10-0700 · task/010-turbot-multi-arena-authoring · d20b75d
2026-09-21-011 · feature · Reset or flag a live run when the machine is edited mid-run (turbot and TM) · 2026-09-24T01:02:21-0700 · task/011-invalidate-run-on-edit · b951340
2026-09-21-012 · feature · Give students a frame player for SC perception questions · 2026-09-24T01:59:05-0700 · task/012-sc-perception-frame-player · b93edcb
2026-09-21-015 · chore · Browser-verify the CSS-only fixes landed without a browser (2026-09-17 pass + two legacy layout items) · 2026-09-24T02:07:33-0700 · task/015-browser-verify-css-fixes · b6d813c
2026-09-21-024 · feature · Shift-click a gate to rotate it, with a light "(shift+click to ↻)" hint beside the Rotate button · 2026-09-24T02:46:34-0700 · task/024-shift-click-rotate · 008b735
2026-09-21-025 · feature · Flash and briefly hold when the turbot reaches the goal, then continue the run · 2026-09-24T03:22:50-0700 · task/025-turbot-goal-flash · 3efc8a1
2026-09-22-028 · feature · Save and load a sandbox worksheet as a file (visitor-mode bells and whistles) · 2026-09-24T04:31:36-0700 · task/028-sandbox-save-load-file · 772a1fa
