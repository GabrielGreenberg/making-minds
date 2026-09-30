# Task 2026-09-29-089 · copy decisions

The rows to change, from the copy pass (https://claude.ai/artifact/BLwAy4V9PFQz6vVPHAV1Qq), located at commit `e2c7f12`. Line numbers may have drifted: find each row by its `old:` text. `{…}` is an interpolated expression and `‹tag›` a child element, both kept as they are in the source. A `…` inside a `{…}` only shortens a long expression for display.

- **Gabriel**: his own decision. Apply it verbatim (single spaces after full stops).
- **suggested**: drafted by Claude from Gabriel's rules (see the task) and released by Gabriel on 2026-09-30 for the robot to apply. Apply as written, unless a suggestion reads wrong in place or breaks a rule. Then fix it and note it in the progress log.

Every row not listed stays as it is. That covers 774 rows checked against the rules and left unchanged, plus 78 developer-only rows that were not reviewed.

### c0001 · CUT · Gabriel
where: Home › Assignments tab · app/src/components/HomeScreen.tsx:84
old: Open a homework to work on it — each question has its own canvas, and your work saves as you go. Submit when you're done; grades appear under Grades once they're released.

### c0002 · REWRITE · Gabriel
where: Home › Assignments tab · app/src/components/HomeScreen.tsx:102
old: · submitted {formatDateTime(nextSub.submittedAt)} — you can submit again until then
new: · submitted {formatDateTime(nextSub.submittedAt)}. You can submit again until then

### c0006 · REWRITE · Gabriel
where: Home › Assignments tab · app/src/components/HomeScreen.tsx:162
old: This assignment closed after its due date — open it to see your submission, read-only.
new: The due date for this assignment has passed. Your submission is now read-only.

### c0008 · REWRITE · Gabriel
where: Home › Assignments tab · app/src/components/HomeScreen.tsx:178
old: Couldn't load assignments — the server may be unreachable. ‹button›
new: Couldn't load assignments. The server may be unreachable. ‹button›

### c0009 · CUT · Gabriel
where: Home › Grades tab · app/src/components/GradesView.tsx:45
old: Your result for each homework, once your instructor releases it. Open a row for the question-by-question sheet.

### c0010 · REWRITE · Gabriel
where: Home › Grades tab · app/src/components/GradesView.tsx:54
old: Couldn't load your grades — the server may be unreachable. ‹button›
new: Couldn't load your grades. The server may be unreachable. ‹button›

### c0015 · REWRITE · Gabriel
where: Feedback form (every signed-in page) · app/src/components/FeedbackPanel.tsx:65
old: Could not attach that image — try a different file.
new: Could not attach that image. Try a different file.

### c0018 · REWRITE · Gabriel
where: Feedback form (every signed-in page) · app/src/components/FeedbackPanel.tsx:85
old: Could not send feedback — the server may be unreachable. Try again in a moment.
new: Could not send feedback. Try again in a moment.

### c0019 · REWRITE · Gabriel
where: Feedback form (every signed-in page) · app/src/components/FeedbackPanel.tsx:99
old: A problem or an idea about the platform or a homework? File it here — it joins the Feedback queue with the instructor tag.
new: File a report here, with the instructor tag.

### c0020 · REWRITE · Gabriel
where: Feedback form (every signed-in page) · app/src/components/FeedbackPanel.tsx:104
old: Something broken, confusing, or wrong in a homework? Tell the instructors. This form is for the platform and the homeworks only: for anything personal (an extension, an absence, a grade), email your instructor instead.
new: Report a bug or technical problem with the homework here. (For issues relating to the class, contact your instructor directly.)

### c0021 · REWRITE · Gabriel
where: Feedback form (every signed-in page) · app/src/components/FeedbackPanel.tsx:112
old: Filed — it’s in the Feedback queue.
new: Filed.

### c0022 · REWRITE · Gabriel
where: Feedback form (every signed-in page) · app/src/components/FeedbackPanel.tsx:112
old: Thanks — an instructor will take a look.
new: Thank you. An instructor will take a look.

### c0028 · REWRITE · Gabriel
where: Assignment page (problem-set document) · app/src/components/AssignmentOverview.tsx:123
old: 🔒 Past due — showing your submission
new: 🔒 Past due. Your submission is read-only.

### c0029 · REWRITE · suggested
where: Assignment page (problem-set document) · app/src/components/AssignmentOverview.tsx:125
old: This assignment closed after its due date — each question shows your submission, read-only.
new: The due date for this assignment has passed. Your submission is now read-only.

### c0030 · REWRITE · suggested
where: Assignment page (problem-set document) · app/src/components/AssignmentOverview.tsx:130
old: Viewing submission {viewing.attempt}, submitted {formatDateTime(viewing.submittedAt)} — read-only · ‹button›
new: Viewing submission {viewing.attempt}, submitted {formatDateTime(viewing.submittedAt)} (read-only) · ‹button›

### c0031 · REWRITE · suggested
where: Assignment page (problem-set document) · app/src/components/AssignmentOverview.tsx:130
old: Each problem opens your answer as submitted in this attempt — Run and Step still work, edits are off.
new: Each problem opens your answer as submitted in this attempt. Run and Step still work. Editing is off.

### c0033 · REWRITE · suggested
where: Assignment page (problem-set document) · app/src/components/ProblemSetDocument.tsx:130
old: Graded on {question.turbot_cases!.length} arenas — this is the first.
new: Graded on {question.turbot_cases!.length} arenas. This is the first.

### c0044 · REWRITE · suggested
where: Grades › question-by-question sheet · app/src/components/GradeSheet.tsx:61
old: arena #{c.k + 1} — {c.stepsTaken} step{c.stepsTaken === 1 ? '' : 's'}, ended at ({c.finalPosition.x}, {c.finalPosition.y}) {c.finalPosition.facing} {c.reason && <> — {c.reason}</>} {runLink(c.k)}
new: arena #{c.k + 1}: {c.stepsTaken} step{c.stepsTaken === 1 ? '' : 's'}, ended at ({c.finalPosition.x}, {c.finalPosition.y}) {c.finalPosition.facing} {c.reason && <> — {c.reason}</>} {runLink(c.k)}

### c0045 · REWRITE · suggested
where: Grades › question-by-question sheet · app/src/components/GradeSheet.tsx:77
old: — first wrong at step {c.failStep}
new: (first wrong at step {c.failStep})

### c0050 · REWRITE · suggested
where: Grades › question-by-question sheet · app/src/components/GradeSheet.tsx:204
old: Grade {formatGrade(score.final)} / 100 — {formatGrade(score.earned)} of {score.available} point{score.available === 1 ? '' : 's'}, scaled as 40 + 60 × {formatGrade(score.earned)}/{score.available}. {score.late?.late && ` Before the late…} {pending > 0 && ` ${pending} problem${…}
new: Grade {formatGrade(score.final)} / 100 ({formatGrade(score.earned)} of {score.available} point{score.available === 1 ? '' : 's'}, scaled as 40 + 60 × {formatGrade(score.earned)}/{score.available}). {score.late?.late && ` Before the late…} {pending > 0 && ` ${pending} problem${…}

### c0051 · REWRITE · suggested
where: Grades › question-by-question sheet · app/src/components/GradeSheet.tsx:207
old: Before the late deduction {formatGrade(score.raw ?? 0)}; {lateLabel(score.late, assignment?.lat…}.
new: Before the late deduction: {formatGrade(score.raw ?? 0)} ({lateLabel(score.late, assignment?.lat…}).

### c0052 · REWRITE · suggested
where: Grades › question-by-question sheet · app/src/components/GradeSheet.tsx:208
old: {pending} problem{pending === 1 ? '' : 's'} still awaiting review — the grade may rise.
new: {pending} problem{pending === 1 ? '' : 's'} still awaiting review. The grade may rise.

### c0054 · REWRITE · suggested
where: Grades sheet · app/src/components/RecordGrade.tsx:21
old: Some problems are still awaiting review — the grade may rise.
new: Some problems are still awaiting review. The grade may rise.

### c0057 · REWRITE · suggested
where: Grades sheet / graded-case banner · app/src/gradeDisplay.ts:121
old: Film #{loaded.caseIndex + 1} — {n} frames
new: Film #{loaded.caseIndex + 1} ({n} frames)

### c0061 · REWRITE · suggested
where: Grades sheet / graded-case banner · app/src/gradeDisplay.ts:164
old: You've changed this question since you submitted — this runs your current machine.
new: You've changed this question since you submitted.

### c0062 · REWRITE · suggested
where: Grades sheet / graded-case banner · app/src/gradeDisplay.ts:165
old: You've submitted again since attempt {loaded.attempt} was graded — this runs your current machine.
new: You've submitted again since attempt {loaded.attempt} was graded.

### c0064 · REWRITE · suggested
where: Page frame (top bar, footer) · app/src/components/PageShell.tsx:94
old: The freeform workbook — opens the circuit editor
new: The freeform workbook

### c0066 · REWRITE · suggested
where: Submit dialog · app/src/components/SubmitDialog.tsx:89
old: This assignment could not be found — reload the page and try again.
new: This assignment could not be found. Reload the page and try again.

### c0068 · REWRITE · suggested
where: Submit dialog · app/src/components/SubmitDialog.tsx:99
old: Submission failed — the server could not be reached, and nothing was recorded. Your work is still saved. Please try Submit again in a moment.
new: Submission failed. The server could not be reached, and nothing was recorded. Your work is still saved. Try Submit again in a moment.

### c0069 · REWRITE · suggested
where: Submit dialog · app/src/components/SubmitDialog.tsx:122
old: Attempt {phase.record.attempt} is recorded. Grades will appear under Grades once your instructor releases them.
new: Attempt {phase.record.attempt} is recorded. Grades will appear under Grades when your instructor releases them.

### c0072 · REWRITE · suggested
where: Submit dialog · app/src/components/SubmitDialog.tsx:189
old: Worked with classmates? List them here — groups are at most 3 people, and each member lists the others on their own submission.
new: List any classmates you worked with. Groups are at most 3 people, and each member lists the others on their own submission.

### c0074 · REWRITE · suggested
where: Submit dialog · app/src/components/SubmitDialog.tsx:196
old: The class list couldn't be loaded — you can still submit without listing a group.
new: The class list couldn't be loaded. You can still submit without listing a group.

### c0077 · REWRITE · suggested
where: Submit dialog · app/src/submissionGroup.ts:48
old: List at most {MAX_GROUP_OTHERS} group members — groups are at most 3 people, you included.
new: List at most {MAX_GROUP_OTHERS} group members. Groups are at most 3 people, including you.

### c0080 · REWRITE · suggested
where: Submit dialog · app/src/submissionGroup.ts:54
old: Don't list yourself — only the classmates you worked with.
new: Don't list yourself.

### c0084 · REWRITE · suggested
where: Submit dialog / console notice · app/src/provenance/notice.ts:27
old: Submit "{title}"? This records a snapshot of your {opts.saved ? 'saved' : 'current'} work. Note: only your most recent submission is graded — submitting again replaces any earlier submission for grading purposes. {SUBMIT_INTEGRITY_SENTENCE}
new: Submit "{title}"? This records your {opts.saved ? 'saved' : 'current'} work. Only your most recent submission is graded. {SUBMIT_INTEGRITY_SENTENCE}

### c0085 · REWRITE · suggested
where: Password panel · app/src/auth/AccountPanel.tsx:64
old: Password changed. You are still signed in here; any other device has been signed out.
new: Password changed. You are still signed in here. Other devices have been signed out.

### c0096 · REWRITE · suggested
where: Server-down retry screen · app/src/auth/HealthGate.tsx:98
old: Your work is safe — nothing is lost — but signing in and saving need the server. Retrying automatically every few seconds. The sandbox works without it.
new: Your work is safe, but signing in and saving need the server. Retrying automatically every few seconds. The sandbox works without it.

### c0101 · REWRITE · suggested
where: Sign-in › first-time claim errors (server) · server/src/identity.ts:132
old: student ID {written} is also on {holder.name}'s account ({holder.email}) but was never verified — if that is this student, add them with that email and this ID; if not, remove that account
new: student ID {written} is also on {holder.name}'s account ({holder.email}) but was never verified. If that is this student, add them with that email and this ID. If not, remove that account

### c0104 · REWRITE · suggested
where: Sign-in › first-time claim errors (server) · server/src/identity.ts:223
old: Enter your student ID (UID) — it confirms the account is yours.
new: Enter your student ID (UID).

### c0108 · REWRITE · suggested
where: Sign-in › first-time claim errors (server) · server/src/identity.ts:245
old: That email already signs in to another account — use the email on your class-list record, or ask your instructor.
new: That email already signs in to another account. Use the email on your class-list record, or ask your instructor.

### c0109 · REWRITE · suggested
where: Sign-in (server replies) · server/src/app.ts:233
old: too many sign-in attempts — wait a few minutes and try again
new: too many sign-in attempts. Wait a few minutes and try again.

### c0111 · REWRITE · suggested
where: Sign-in (server replies) · server/src/app.ts:265
old: too many attempts — wait a few minutes and try again
new: too many attempts. Wait a few minutes and try again.

### c0116 · REWRITE · suggested
where: Sign-in (server replies) · server/src/app.ts:350
old: too many requests — try again later
new: too many requests. Try again later.

### c0118 · REWRITE · suggested
where: Sign-in (server) · server/src/auth.ts:132
old: An account already exists for you — sign in instead.
new: An account already exists for you. Sign in instead.

### c0123 · REWRITE · suggested
where: Sign-in errors · app/src/auth/authProvider.tsx:305,322,339,353
old: Could not reach the server — check your connection.
new: Could not reach the server. Check your connection.

### c0125 · REWRITE · suggested
where: Sign-in screen · app/src/auth/LoginScreen.tsx:49
old: Just exploring? Continue as visitor to build circuits, state machines and Turing machines. No account needed.
new: Continue as visitor to build circuits, state machines and Turing machines. No account needed.

### c0130 · REWRITE · suggested
where: Sign-in screen · app/src/auth/LoginScreen.tsx:162
old: First time here? Set up your account
new: Set up your account

### c0131 · REWRITE · suggested
where: Sign-in screen · app/src/auth/LoginScreen.tsx:167
old: Not on the class roster? Ask to be added
new: Ask to be added to the class roster

### c0137 · REWRITE · suggested
where: Sign-in screen · app/src/auth/LoginScreen.tsx:242
old: Forgot your password? Ask your instructor to reset it — they can clear it so you can set a new one.
new: If you forget your password, ask your instructor to reset it.

### c0138 · REWRITE · suggested
where: Sign-in screen · app/src/auth/LoginScreen.tsx:293
old: Your UID (student ID) finds you on the class roster. Then choose the email you'll sign in with — your UCLA address, or the email on your class-list record — and a password.
new: Enter your UID (student ID). Then choose a password and the email you'll sign in with (your UCLA address, or the email on your class-list record).

### c0146 · REWRITE · suggested
where: Sign-in screen · app/src/auth/LoginScreen.tsx:399
old: Request sent. Your instructor will review it — once they add you, come back and set up your account.
new: Request sent. Your instructor will review it. When they add you, come back and set up your account.

### c0152 · REWRITE · suggested
where: Editor › box editing bar · app/src/components/BoxEditorBar.tsx:48
old: Save: update every copy
new: Save and update every copy

### c0156 · REWRITE · suggested
where: Editor › boxing errors · app/src/boxEditing.ts:134
old: Give the box at least one output: an OUT node.
new: Give the box at least one OUT node.

### c0160 · REWRITE · suggested
where: Editor › boxing errors · app/src/boxEditing.ts:149
old: Free end: an output of {c.label} is not connected. Wire it on, or to an OUT node.
new: Free end: an output of {c.label} is not connected. Wire it to another part or to an OUT node.

### c0161 · REWRITE · suggested
where: Editor › canvas · app/src/components/CircuitCanvas.tsx:770
old: No arrow for input {uncoveredSymbols.join(', ')} — the machine halts here if it reads {uncoveredSymbols.length === 1 ? 'it' …}
new: No arrow for input {uncoveredSymbols.join(', ')}. The machine halts here if it reads {uncoveredSymbols.length === 1 ? 'it' …}.

### c0162 · REWRITE · suggested
where: Editor › canvas · app/src/components/CircuitCanvas.tsx:969
old: Routing warning: {violation} — try dragging a wire segment
new: Routing warning: {violation}. Try dragging a wire segment.

### c0163 · CUT · suggested
where: Editor › canvas · app/src/components/CircuitCanvas.tsx:971
old: Routing note: this wire used the simple fallback path

### c0164 · REWRITE · suggested
where: Editor › canvas · app/src/components/CircuitCanvas.tsx:1775
old: Put away: take this design off the canvas (the box stays in the library)
new: Take this box off the canvas (it stays in the library)

### c0168 · REWRITE · suggested
where: Editor › canvas · app/src/components/CircuitCanvas.tsx:1941
old: Warning: {label} has ports not connected to anything inside — draw and place it again
new: Warning: {label} has ports not connected to anything inside. Draw and place it again.

### c0188 · REWRITE · suggested
where: Editor › canvas hint line · app/src/canvasView.ts:181
old: Build the box: an IN node for each input, an OUT node for each output, and the parts between them.
new: Build the box with an IN node for each input, an OUT node for each output, and the parts between them.

### c0192 · REWRITE · suggested
where: Editor › I/O table · app/src/components/DataTable.tsx:406
old: No arrow for input {row.input} — the machine halts in {row.state} if it reads {row.input}
new: No arrow for input {row.input}. The machine halts in {row.state} if it reads {row.input}.

### c0203 · REWRITE · suggested
where: Editor › labels (save state, notes) · app/src/workbench.ts:241
old: Not saved — retrying
new: Not saved. Retrying…

### c0211 · REWRITE · suggested
where: Editor › machine menu · app/src/components/MachineMenu.tsx:79
old: ‹ Turbot — pick its brain
new: ‹ Turbot: pick its brain

### c0212 · REWRITE · suggested
where: Editor › messages & lock notices · app/src/store.ts:225
old: Showing {s.viewingOwner.name}'s submission — read-only.
new: {s.viewingOwner.name}'s submission is read-only.

### c0213 · REWRITE · suggested
where: Editor › messages & lock notices · app/src/store.ts:225
old: Showing your submission — read-only.
new: Your submission is read-only.

### c0214 · REWRITE · suggested
where: Editor › messages & lock notices · app/src/store.ts:227
old: Marked done — unlock this question to keep editing.
new: Marked done. Unlock this question to keep editing.

### c0237 · REWRITE · suggested
where: Editor › messages & lock notices · app/src/store.ts:3618
old: Memory cannot go inside a box here: this canvas takes combinational boxes only.
new: Memory cannot go inside a box here. This canvas takes combinational boxes only.

### c0239 · REWRITE · suggested
where: Editor › messages & lock notices · app/src/store.ts:5673
old: This question shows {state.viewingOwner ? `${state.viewing…} submission, read-only — you can't {what} here.
new: This question shows {state.viewingOwner ? `${state.viewing…} submission, which is read-only. You can't {what} here.

### c0240 · REWRITE · suggested
where: Editor › messages & lock notices · app/src/store.ts:5674
old: This question is marked done — unlock it to {what}.
new: This question is marked done. Unlock it to {what}.

### c0244 · REWRITE · suggested
where: Editor › parts palette · app/src/components/Palette.tsx:468
old: Box: select parts and click to box them, or click and then drag a rectangle around them. IN and OUT nodes inside become its ports, and so does every wire end its edge cuts.
new: Box: select parts and click to box them, or click and then drag a rectangle around them. IN and OUT nodes inside become its ports, and so do wires cut by its edge.

### c0265 · REWRITE · suggested
where: Editor › paste refusals · app/src/provenance.ts:161
old: Nothing to paste: copy something in this window first.
new: Nothing to paste. Copy something in this window first.

### c0270 · REWRITE · suggested
where: Editor › paste refusals · app/src/provenance.ts:167
old: Drag-and-drop is off in assignments: copy and paste instead.
new: Drag-and-drop is off in assignments. Copy and paste instead.

### c0278 · REWRITE · suggested
where: Editor › perception frame player · app/src/components/PerceptionFramePlayer.tsx:168
old: Add a frame (+) — each frame is one clock tick.
new: Add a frame (+). Each frame is one clock tick.

### c0283 · REWRITE · suggested
where: Editor › perception frame player · app/src/components/PerceptionFramePlayer.tsx:193
old: ⚠ {verdict.reason} — the grader rejects this machine; the run still plays.
new: ⚠ {verdict.reason}. This machine will not pass grading, but the run still plays.

### c0288 · REWRITE · suggested
where: Editor › question panel · app/src/components/QuestionPanel.tsx:168
old: This assignment closed after its due date — showing your submitted answer, read-only.
new: The due date for this assignment has passed. Your submission is now read-only.

### c0289 · REWRITE · suggested
where: Editor › question panel · app/src/components/QuestionPanel.tsx:172
old: Your answer as submitted in attempt {viewing.attempt}, read-only — Run and Step still work.
new: Your answer as submitted in attempt {viewing.attempt} is read-only. Run and Step still work.

### c0290 · REWRITE · suggested
where: Editor › question panel · app/src/components/QuestionPanel.tsx:177
old: Locked — uncheck “I'm done” to edit
new: Locked. Uncheck “I'm done” to edit.

### c0291 · REWRITE · suggested
where: Editor › question panel · app/src/components/QuestionPanel.tsx:276
old: 🔒 Locked against edits — uncheck to keep working.
new: 🔒 Locked against edits. Uncheck to keep working.

### c0295 · REWRITE · suggested
where: Editor › TM tape · app/src/components/TMTapePanel.tsx:74
old: cell {i} — click to change
new: cell {i}: click to change

### c0296 · REWRITE · suggested
where: Editor › top bar · app/src/components/EditorTopBar.tsx:40
old: {owner.name}'s submission — every problem
new: {owner.name}'s submission (every problem)

### c0297 · REWRITE · suggested
where: Editor › top bar · app/src/components/EditorTopBar.tsx:72
old: Home — your assignments
new: Home

### c0299 · REWRITE · suggested
where: Editor › top bar · app/src/components/EditorTopBar.tsx:92
old: {assignment.title} — the whole problem set
new: {assignment.title} (the whole problem set)

### c0300 · REWRITE · suggested
where: Editor › top bar · app/src/components/EditorTopBar.tsx:113
old: The server could not be reached — your work is kept in this browser and saving will retry automatically
new: The server could not be reached. Your work is kept in this browser, and saving will retry automatically.

### c0301 · REWRITE · suggested
where: Editor › top bar · app/src/components/EditorTopBar.tsx:120
old: 🔒 Past due — viewing your submission
new: 🔒 Past due. Your submission is read-only.

### c0302 · REWRITE · suggested
where: Editor › top bar · app/src/components/EditorTopBar.tsx:120
old: This assignment closed after its due date — you're viewing your submission, read-only.
new: The due date for this assignment has passed. Your submission is now read-only.

### c0303 · REWRITE · suggested
where: Editor › top bar · app/src/components/EditorTopBar.tsx:126
old: Viewing {owner.name}'s attempt {viewingSubmission.attempt} — read-only
new: Viewing {owner.name}'s attempt {viewingSubmission.attempt} (read-only)

### c0304 · REWRITE · suggested
where: Editor › top bar · app/src/components/EditorTopBar.tsx:126
old: {owner.name}'s answers as submitted in this attempt — Run and Step still work, edits are off.
new: {owner.name}'s answers as submitted in this attempt are read-only. Run and Step still work.

### c0307 · REWRITE · suggested
where: Editor › top bar · app/src/components/EditorTopBar.tsx:141
old: Viewing submission {viewingSubmission.attempt} — read-only
new: Viewing submission {viewingSubmission.attempt} (read-only)

### c0308 · REWRITE · suggested
where: Editor › top bar · app/src/components/EditorTopBar.tsx:141
old: Your answers as submitted in this attempt — Run and Step still work, edits are off.
new: Your answers as submitted in this attempt are read-only. Run and Step still work.

### c0314 · REWRITE · suggested
where: Editor › truth table · app/src/components/LiveTruthTable.tsx:51
old: This circuit has more than {TRUTH_TABLE_MAX_INPUTS} inputs — too many rows to list.
new: Too many rows to list. This circuit has more than {TRUTH_TABLE_MAX_INPUTS} inputs.

### c0317 · REWRITE · suggested
where: Editor › turbot map · app/src/components/TurbotArenaPanel.tsx:31
old: Move the turbot start; click its cell again to rotate
new: Move the turbot start (click its cell again to rotate)

### c0344 · REWRITE · suggested
where: Editor › written-problem worksheet · app/src/components/Worksheet.tsx:367
old: Not saved yet — your answer is kept in this browser, and saving retries on its own.
new: Not saved yet. Your answer is kept in this browser, and saving retries on its own.

### c0355 · REWRITE · suggested
where: Fill-in grading · app/src/engine/fillIn.ts:259
old: fill-in table gives students {rows} rows; the most it may give is {FILL_IN_TABLE_MAX_ROWS}
new: fill-in table gives students {rows} rows, but the most it may give is {FILL_IN_TABLE_MAX_ROWS}

### c0370 · REWRITE · suggested
where: Grader · app/src/engine/grader.ts:117
old: open question — needs manual review
new: open question (needs manual review)

### c0371 · REWRITE · suggested
where: Grader · app/src/engine/grader.ts:144
old: table — needs manual review
new: table (needs manual review)

### c0373 · REWRITE · suggested
where: Grader case runs · app/src/engine/caseRun.ts:232
old: machine used {used} tape cells — this question allows at most {maxTapeCells}
new: machine used {used} tape cells, but this question allows at most {maxTapeCells}

### c0377 · REWRITE · suggested
where: Machine validation · app/src/engine/machineValidation.ts:117
old: a combinatorial circuit holds no memory: remove its MEM blocks (and any box holding one)
new: a combinatorial circuit holds no memory. Remove its MEM blocks (and any box holding one)

### c0378 · REWRITE · suggested
where: Machine validation · app/src/engine/machineValidation.ts:131
old: machine uses disallowed component type(s): {offenders.join(', ')} — this question allows only: {allowed!.join(', ')} (boxed circuits are checked inside)
new: machine uses disallowed component type(s): {offenders.join(', ')}. This question allows only {allowed!.join(', ')} (boxed circuits are checked inside)

### c0385 · REWRITE · suggested
where: Machine validation · app/src/engine/machineValidation.ts:244
old: FSM questions support at most {FSM_MAX_INPUT_GROUPS} input groups (this question declares {kIn}; its alphabet would have {2 ** kIn} input symbols)
new: FSM questions support at most {FSM_MAX_INPUT_GROUPS} input groups (this question declares {kIn}, an alphabet of {2 ** kIn} input symbols)

### c0395 · REWRITE · suggested
where: Perception checks & rules · app/src/engine/perception.ts:341
old: frame t{t + 1} has {Array.isArray(f) ? f.length : 0} bits — the retina is {width} wires
new: frame t{t + 1} has {Array.isArray(f) ? f.length : 0} bits, but the retina is {width} wires

### c0397 · REWRITE · suggested
where: Perception checks & rules · app/src/engine/perception.ts:373
old: perception width must be an integer in {MIN_PERCEPTION_WIDTH}..{MAX_PERCEPTION_WIDTH}
new: perception width must be a whole number from {MIN_PERCEPTION_WIDTH} to {MAX_PERCEPTION_WIDTH}

### c0404 · REWRITE · suggested
where: Perception checks & rules · app/src/engine/perception.ts:396
old: a CC perception bank is already exhaustive — films are for SC rules only
new: a CC perception rule takes no films (films are for SC rules only)

### c0414 · REWRITE · suggested
where: Transition-label errors · app/src/engine/notation.ts:312
old: transition "{raw}" has a {parts[0].length}-bit input symbol; this question has {notation.inputWidth} input wire{notation.inputWidth === 1 ? '' : 's'}.
new: transition "{raw}" has a {parts[0].length}-bit input symbol, but this question has {notation.inputWidth} input wire{notation.inputWidth === 1 ? '' : 's'}.

### c0415 · REWRITE · suggested
where: Transition-label errors · app/src/engine/notation.ts:316
old: transition "{raw}" has a {parts[1].length}-bit output symbol; this question has {outWidth} output wire{outWidth === 1 ? '' : 's'}.
new: transition "{raw}" has a {parts[1].length}-bit output symbol, but this question has {outWidth} output wire{outWidth === 1 ? '' : 's'}.

### c0418 · REWRITE · suggested
where: Transition-label errors · app/src/engine/notation.ts:413
old: state {s.label} has {ids.length} transitions for input {sym} (must be at most one — the machine is nondeterministic)
new: state {s.label} has {ids.length} transitions for input {sym} (must be at most one)

### c0429 · REWRITE · suggested
where: Sandbox › File menu · app/src/components/WorkbookFileMenu.tsx:88
old: Couldn't save the workbook — Open couldn't read the file back: {unopenable}.
new: Couldn't save the workbook: {unopenable}.

### c0434 · REWRITE · suggested
where: Sandbox › File menu · app/src/components/WorkbookFileMenu.tsx:233
old: This workbook's name — Save as… names it after its file
new: This workbook's name. Save as… names it after its file.

### c0440 · REWRITE · suggested
where: Sandbox › File menu · app/src/components/WorkbookFileMenu.tsx:267
old: Your browser is downloading “{prompt.name}”. Once it's in your downloads, {prompt.pending.kind === 'new' ? 'star…} — it will replace this one.
new: Your browser is downloading “{prompt.name}”. When it's in your downloads, {prompt.pending.kind === 'new' ? 'star…}. It will replace this one.

### c0446 · REWRITE · suggested
where: Sandbox › File menu · app/src/fileHandle.ts:157
old: the browser blocked the file dialog — choose Open… again
new: the browser blocked the file dialog. Choose Open… again

### c0447 · REWRITE · suggested
where: Sandbox › File menu (opening a bad file) · app/src/workbookFile.ts:54
old: the file is {(size / 1e6).toFixed(1)} MB; a workbook file is at most {MAX_WORKBOOK_FILE_CHARS / 1e6} MB
new: the file is {(size / 1e6).toFixed(1)} MB, but a workbook file is at most {MAX_WORKBOOK_FILE_CHARS / 1e6} MB

### c0487 · REWRITE · suggested
where: Sandbox › visitor banner · app/src/components/VisitorBanner.tsx:35
old: You're in the sandbox as a visitor — build anything; it stays in this browser. PHIL 133 student? ‹button›
new: You're in the sandbox as a visitor. Anything you build stays in this browser. PHIL 133 students: ‹button›

### c0493 · REWRITE · suggested
where: Assignment editor · app/src/instructor/AssignmentEditor.tsx:242
old: −5 once late, then −5 per class meeting that has ended since the due date — or per full day
new: −5 once late, then −5 per class meeting that has ended since the due date (or per full day)

### c0497 · REWRITE · suggested
where: Assignment editor · app/src/instructor/AssignmentEditor.tsx:261
old: Preamble (optional — shown under the title, before the first section)
new: Preamble (optional, shown under the title before the first section)

### c0498 · REWRITE · suggested
where: Assignment editor · app/src/instructor/AssignmentEditor.tsx:271
old: Original PDF (optional — a URL, or a path under the app such as problem-sets/hw1.pdf)
new: Original PDF (optional, a URL or a path under the app such as problem-sets/hw1.pdf)

### c0499 · REWRITE · suggested
where: Assignment editor · app/src/instructor/AssignmentEditor.tsx:286
old: No sections: the problems are listed in order. Add a section to give a run of problems a heading and an instruction of its own, as the printed problem sets do.
new: No sections. The problems are listed in order. Add a section to give a run of problems its own heading and instruction.

### c0502 · REWRITE · suggested
where: Assignment editor · app/src/instructor/AssignmentEditor.tsx:317
old: Intro (optional — the instruction for this run of problems)
new: Intro (optional, the instruction for this run of problems)

### c0504 · REWRITE · suggested
where: Assignment editor · app/src/instructor/AssignmentEditor.tsx:335
old: none yet — file them from the question list below.
new: none yet. File them from the question list below.

### c0507 · REWRITE · suggested
where: Assignment editor · app/src/instructor/AssignmentEditor.tsx:392
old: Shown on its problem’s page; graded on its own
new: Shown on its problem’s page. Graded on its own.

### c0509 · REWRITE · suggested
where: Assignment editor · app/src/instructor/AssignmentEditor.tsx:394
old: — not folded
new: (not folded)

### c0510 · REWRITE · suggested
where: Assignment editor · app/src/instructor/AssignmentEditor.tsx:433
old: Preview — the problem set as students see it (click a problem to edit it)
new: Preview of the problem set as students see it (click a problem to edit it)

### c0514 · REWRITE · suggested
where: Assignment editor › callouts & figures · app/src/instructor/DocumentEditors.tsx:34
old: This SVG is {Math.round(file.size / 1024)} KB; figures are capped at {MAX_FIGURE_BYTES / 1024} KB.
new: This SVG is {Math.round(file.size / 1024)} KB. Figures are capped at {MAX_FIGURE_BYTES / 1024} KB.

### c0516 · REWRITE · suggested
where: Assignment editor › callouts & figures · app/src/instructor/DocumentEditors.tsx:56
old: Canvas unavailable.
new: Could not process the image.

### c0519 · REWRITE · suggested
where: Assignment editor › callouts & figures · app/src/instructor/DocumentEditors.tsx:217
old: The box's text — same markup as a statement.
new: The box's text, in the same markup as a statement.

### c0521 · REWRITE · suggested
where: Dashboard › assignments · app/src/storage/AssignmentStore.ts:45
old: students have submitted this assignment — hide it instead of deleting it
new: students have submitted this assignment. Hide it instead of deleting it

### c0531 · REWRITE · suggested
where: Dashboard › Assignments tab · app/src/instructor/InstructorDashboard.tsx:114
old: Load the real PHIL 133 homeworks (HW1–HW7) as editable assignments; a copy you have not edited is refreshed to the repo version, an edited one is left alone
new: Load the real PHIL 133 homeworks (HW1–HW7) as editable assignments. Unedited copies are refreshed to the repo version. Edited ones are left alone.

### c0532 · REWRITE · suggested
where: Dashboard › Assignments tab · app/src/instructor/InstructorDashboard.tsx:128
old: Couldn’t load assignments — the server may be unreachable. ‹button›
new: Couldn’t load assignments. The server may be unreachable. ‹button›

### c0538 · REWRITE · suggested
where: Dashboard › Assignments tab · app/src/instructor/InstructorDashboard.tsx:202
old: Students have submitted this — hide it instead
new: Students have submitted this. Hide it instead.

### c0539 · REWRITE · suggested
where: Dashboard gate · app/src/instructor/InstructorGate.tsx:28
old: This area is for authoring assignments and reviewing submissions. You are signed in as {user ? `${user.name} (student)` : 'a …}, so it isn't available to you.
new: You are signed in as {user ? `${user.name} (student)` : 'a …}, so this area isn't available to you.

### c0541 · REWRITE · suggested
where: Feedback tab · app/src/instructor/FeedbackQueueView.tsx:26
old: Personal — for you
new: Personal (for you)

### c0544 · REWRITE · suggested
where: Feedback tab · app/src/instructor/FeedbackQueueView.tsx:111
old: No open feedback — nice.
new: No open feedback.

### c0548 · REWRITE · suggested
where: Grading › assignment · app/src/instructor/GradingAssignment.tsx:39
old: Couldn’t load grading — the server may be unreachable.
new: Couldn’t load grading. The server may be unreachable.

### c0556 · REWRITE · suggested
where: Grading › Extension / Waive · app/src/instructor/LateAdjustControls.tsx:146
old: Could not save — the server may be unreachable. Try again.
new: Could not save. The server may be unreachable. Try again.

### c0557 · REWRITE · suggested
where: Grading › Extension / Waive · app/src/instructor/LateAdjustControls.tsx:173
old: Pick a date and time — or Clear to remove the extension.
new: Pick a date and time, or Clear to remove the extension.

### c0561 · REWRITE · suggested
where: Grading › Extension / Waive · app/src/instructor/LateAdjustControls.tsx:196
old: No reason is recorded — accommodation details stay off the platform.
new: No reason is recorded. Accommodation details stay off the platform.

### c0562 · REWRITE · suggested
where: Grading › Extension / Waive · app/src/instructor/LateAdjustControls.tsx:230
old: Waive a whole number of points, at least 1 — or Clear to remove the waiver.
new: Waive a whole number of points (at least 1), or Clear to remove the waiver.

### c0564 · REWRITE · suggested
where: Grading › Extension / Waive · app/src/instructor/LateAdjustControls.tsx:238
old: Reduces this student’s late deduction on this assignment — never below zero. The student sees the points, not the note.
new: Reduces this student’s late deduction on this assignment (not below zero). The student sees the points, not the note.

### c0575 · REWRITE · suggested
where: Grading › flags · app/src/storage/gradingFlags.ts:188
old: listed by a classmate; no submission
new: listed by a classmate but has not submitted

### c0593 · REWRITE · suggested
where: Grading › grade-write rules · app/src/engine/score.ts:326
old: the ½ rule asks for {k} of {n} case{n === 1 ? '' : 's'} — it must be fewer than all of them
new: the ½ rule asks for {k} of {n} case{n === 1 ? '' : 's'}. It must be fewer than all of them

### c0594 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:151
old: {o.count} of {plural(ids.length, 'id')} {o.count === 1 ? 'was' : 'were'} created in {o.email}'s editor for this assignment — to look at.
new: {o.count} of {plural(ids.length, 'id')} {o.count === 1 ? 'was' : 'were'} created in {o.email}'s editor for this assignment.

### c0595 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:158
old: {unbound} of {plural(ids.length, 'id')} {unbound === 1 ? 'was' : 'were'} not created in this student's editor for this assignment (brought in from the sandbox, a file, the browser console or another tool?) — to look at.
new: {unbound} of {plural(ids.length, 'id')} {unbound === 1 ? 'was' : 'were'} not created in this student's editor for this assignment (brought in from the sandbox, a file, the browser console or another tool?).

### c0596 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:187
old: The answer text carries {from}'s stamp — to look at.
new: The answer text carries {from}'s stamp.

### c0597 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:191
old: The answer text differs from the text its editing record stamps (changed outside the editor?) — to look at.
new: The answer text differs from the text its editing record stamps (changed outside the editor?).

### c0598 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:194
old: The answer text has no stamp from this student's editor — to look at.
new: The answer text has no stamp from this student's editor.

### c0599 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:199
old: The editing record was made in {from}'s editor — to look at.
new: The editing record was made in {from}'s editor.

### c0600 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:204
old: The text was changed outside the editor ({plural(trace.outside, 'time')}) and then edited on — to look at.
new: The text was changed outside the editor ({plural(trace.outside, 'time')}) and then edited on.

### c0601 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:211
old: {trace.maxTextIns} of {size.t} characters arrived in one insertion (an in-app paste of the student's own text, or text set from outside the editor) — to look at.
new: {trace.maxTextIns} of {size.t} characters arrived in one insertion (an in-app paste of the student's own text, or text set from outside the editor).

### c0602 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:223
old: {typed} characters were entered in {(trace.activeMs / 1000).toFixed(1)} s of active editing, faster than a person types (a script entering text a keystroke at a time?) — to look at.
new: {typed} characters were entered in {(trace.activeMs / 1000).toFixed(1)} s of active editing, faster than a person types (a script entering text a keystroke at a time?).

### c0603 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:235
old: {trace.maxCompIns} of {size.c} components arrived in one in-app paste (the student's own work carried from another question or assignment?) — to look at.
new: {trace.maxCompIns} of {size.c} components arrived in one in-app paste (the student's own work carried from another question or assignment?).

### c0606 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:249
old: The answer has {parts.join('; ')} — to look at.
new: The answer has {parts.join('; ')}.

### c0607 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:257
old: The answer has no {record === 'invalid' ? 'valid ' : ''}editing record from this student's editor ({plural(size.c, 'component')}, {plural(size.t, 'character')} of text) — to look at.
new: The answer has no {record === 'invalid' ? 'valid ' : ''}editing record from this student's editor ({plural(size.c, 'component')}, {plural(size.t, 'character')} of text).

### c0609 · REWRITE · suggested
where: Grading › integrity flags · app/src/provenance/integrity.ts:297
old: {parts.join(' and ')} appeared between two saves{context} — to look at.
new: {parts.join(' and ')} appeared between two saves{context}.

### c0623 · REWRITE · suggested
where: Grading › labels & tiles · app/src/instructor/gradingViews.ts:78
old: changed since graded — the old grade is a suggestion
new: changed since graded (the old grade is a suggestion)

### c0633 · REWRITE · suggested
where: Grading › Matrix · app/src/instructor/GradingMatrix.tsx:72
old: Flags — to look at, not verdicts: {flagTip(r)}
new: Flags (to look at, not verdicts): {flagTip(r)}

### c0636 · REWRITE · suggested
where: Grading › Matrix · app/src/instructor/GradingMatrix.tsx:112
old: Integrity — to look at, not a verdict: {c.flags.join('\n')}
new: Integrity (to look at, not a verdict): {c.flags.join('\n')}

### c0640 · REWRITE · suggested
where: Grading › Matrix · app/src/instructor/GradingMatrix.tsx:195
old: Not counted — submitted, but not on the roster
new: Not counted (submitted, but not on the roster)

### c0643 · REWRITE · suggested
where: Grading › Matrix · app/src/instructor/GradingMatrix.tsx:212
old: ⚑ on a problem: integrity flags; after a name: that student's flags here — to look at, not a verdict
new: ⚑ on a problem: integrity flags. After a name: that student's flags here. (To look at, not a verdict.)

### c0649 · REWRITE · suggested
where: Grading › Overview · app/src/instructor/GradingOverview.tsx:82
old: {plural(t.autograded.stale, 'submission')} graded against an older version of this assignment. Their autogrades stand until a re-grade; hand grades are never touched by one.
new: {plural(t.autograded.stale, 'submission')} graded against an older version of this assignment. Their autogrades stand until a re-grade. A re-grade does not change hand grades.

### c0650 · REWRITE · suggested
where: Grading › Overview · app/src/instructor/GradingOverview.tsx:154
old: Shares are over the {plural(summary.progress.submitted, 'r…}; each student's latest attempt counts. Open the Matrix to see every student.
new: Shares are over the {plural(summary.progress.submitted, 'r…}. Each student's latest attempt counts. Open the Matrix to see every student.

### c0652 · REWRITE · suggested
where: Grading › Queue · app/src/instructor/GradingQueue.tsx:143
old: No problem here needs a person — every answer is autograded.
new: No problem here needs a person. Every answer is autograded.

### c0660 · REWRITE · suggested
where: Grading › Queue · app/src/instructor/GradingQueue.tsx:293
old: {claimed.map(({ r, i }) => `${response…}. Claims lapse after 5 minutes idle; nothing is locked.
new: {claimed.map(({ r, i }) => `${response…}. Claims lapse after 5 minutes idle. Nothing is locked.

### c0664 · REWRITE · suggested
where: Grading › Queue · app/src/instructor/GradingQueue.tsx:402
old: {label} has nothing waiting on a person.
new: {label} has nothing to grade by hand.

### c0667 · REWRITE · suggested
where: Grading › Queue · app/src/instructor/GradingQueue.tsx:456
old: All caught up — nobody else has a problem waiting.
new: All caught up. Nobody else has a problem waiting.

### c0670 · REWRITE · suggested
where: Grading › Queue · app/src/instructor/GradingQueue.tsx:634
old: Couldn’t save — the server may be unreachable. Try again.
new: Couldn’t save. The server may be unreachable. Try again.

### c0673 · REWRITE · suggested
where: Grading › Queue · app/src/instructor/GradingQueue.tsx:712
old: Being graded by {claimedBy} right now. Nothing is locked — but a grade saved over theirs will ask first.
new: Being graded by {claimedBy} right now. Nothing is locked, but you will be asked before saving over their grade.

### c0674 · REWRITE · suggested
where: Grading › Queue · app/src/instructor/GradingQueue.tsx:720
old: Graded {pointsText(suggestion.points)} on attempt {suggestion.attempt ?? '?'} — the answer has since changed. ‹button›
new: Graded {pointsText(suggestion.points)} on attempt {suggestion.attempt ?? '?'}. The answer has since changed. ‹button›

### c0675 · REWRITE · suggested
where: Grading › Queue · app/src/instructor/GradingQueue.tsx:732
old: Graded {pointsText(conflict.current.points)} by {conflict.current.grader ?? 'someone e…} meanwhile — theirs stands.
new: Graded {pointsText(conflict.current.points)} by {conflict.current.grader ?? 'someone e…} meanwhile. Their grade stands.

### c0686 · REWRITE · suggested
where: Grading › Queue · app/src/instructor/GradingQueue.tsx:801
old: — nothing to grade against
new: (nothing to grade against)

### c0689 · REWRITE · suggested
where: Grading › Re-grade dialog · app/src/instructor/RegradeDialog.tsx:35
old: The dry run failed — the server may be unreachable. Nothing was changed.
new: The dry run failed. The server may be unreachable. Nothing was changed.

### c0690 · REWRITE · suggested
where: Grading › Re-grade dialog · app/src/instructor/RegradeDialog.tsx:60
old: The assignment changed since the dry run — here is the dry run against the current version. Nothing was saved.
new: The assignment changed since the dry run. This is a new dry run against the current version. Nothing was saved.

### c0691 · REWRITE · suggested
where: Grading › Re-grade dialog · app/src/instructor/RegradeDialog.tsx:66
old: The re-grade failed — nothing was changed. Try again in a moment.
new: The re-grade failed. Nothing was changed. Try again in a moment.

### c0692 · REWRITE · suggested
where: Grading › Re-grade dialog · app/src/instructor/RegradeDialog.tsx:82
old: — dry run
new: (dry run)

### c0694 · REWRITE · suggested
where: Grading › Re-grade dialog · app/src/instructor/RegradeDialog.tsx:129
old: All {plural(plan.latest, 'latest submission')} were graded against the current {title}; there is nothing to re-grade.
new: All {plural(plan.latest, 'latest submission')} were graded against the current {title}. There is nothing to re-grade.

### c0696 · REWRITE · suggested
where: Grading › Re-grade dialog · app/src/instructor/RegradeDialog.tsx:154
old: under your override ({r.override}) — override stays; flagged for a look
new: under your override ({r.override}). Your override stays and is flagged for a look.

### c0697 · REWRITE · suggested
where: Grading › Re-grade dialog · app/src/instructor/RegradeDialog.tsx:168
old: No problem's points change — a commit only records that these results are current.
new: No problem's points change. A commit records that these results are current.

### c0698 · REWRITE · suggested
where: Grading › Re-grade dialog · app/src/instructor/RegradeDialog.tsx:171
old: {summary.changes} · {summary.rest} A database snapshot is taken before the commit; every change is logged.
new: {summary.changes} · {summary.rest} A database snapshot is taken before the commit. Every change is logged.

### c0699 · REWRITE · suggested
where: Grading › Re-grade dialog · app/src/instructor/RegradeDialog.tsx:194
old: Re-graded {plural(plan.stale, 'submission')}: {plural(plan.changed.length, 'result')} changed, each logged. Hand grades and overrides were not touched.
new: Re-graded {plural(plan.stale, 'submission')}. {plural(plan.changed.length, 'result')} changed, each logged. Hand grades and overrides were not touched.

### c0700 · REWRITE · suggested
where: Grading › Re-grade dialog · app/src/instructor/RegradeDialog.tsx:196
old: Nothing was stale by the time of the commit — nothing changed.
new: Nothing was stale by the time of the commit. Nothing changed.

### c0702 · REWRITE · suggested
where: Grading › shared parts · app/src/instructor/GradingParts.tsx:46
old: Provisional — some problems still await a hand grade
new: Provisional. Some problems still need a hand grade.

### c0704 · REWRITE · suggested
where: Grading › shared parts · app/src/instructor/GradingParts.tsx:105
old: Couldn’t export — the server may be unreachable.
new: Couldn’t export. The server may be unreachable.

### c0707 · REWRITE · suggested
where: Grading › student page · app/src/instructor/StudentGradingView.tsx:37
old: Couldn’t load this student — the server may be unreachable.
new: Couldn’t load this student. The server may be unreachable.

### c0712 · REWRITE · suggested
where: Grading › student page · app/src/instructor/StudentGradingView.tsx:56
old: Flags — prompts to look, never verdicts
new: Flags

### c0715 · REWRITE · suggested
where: Grading › student page · app/src/instructor/StudentGradingView.tsx:143
old: — provisional, hand grading still pending
new: (provisional, hand grading still pending)

### c0717 · REWRITE · suggested
where: Grading › student page · app/src/instructor/StudentGradingView.tsx:189
old: Couldn’t save the note — the server may be unreachable.
new: Couldn’t save the note. The server may be unreachable.

### c0718 · REWRITE · suggested
where: Grading › student page · app/src/instructor/StudentGradingView.tsx:197
old: Instructors only — never shown to the student. Notes can't be edited or deleted.
new: Only instructors see these notes. They can't be edited or deleted.

### c0721 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:44
old: Couldn’t load this submission — the server may be unreachable.
new: Couldn’t load this submission. The server may be unreachable.

### c0728 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:100
old: Missing — nothing submitted by the due date.
new: Missing. Nothing was submitted by the due date.

### c0733 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:133
old: Older attempts {detail.record.attempt - 1}, read-only below — only the latest counts.
new: Older attempts {detail.record.attempt - 1}, read-only below. Only the latest counts.

### c0736 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:155
old: Read-only — only the latest attempt counts, and only it takes grades.
new: Read-only. Only the latest attempt counts and takes grades.

### c0744 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:265
old: {pointsLabel(p.points!)} — the ½ rule
new: {pointsLabel(p.points!)} by the ½ rule

### c0745 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:291
old: Not autograded — this attempt predates grading on receipt.
new: Not autograded. This attempt was submitted before autograding began.

### c0753 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:544
old: ½ rule: at least {k} of {qr.total} case{qr.total === 1 ? '' : 's'} — passed {qr.passed}, {met ? 'met' : 'not met'}
new: ½ rule: at least {k} of {qr.total} case{qr.total === 1 ? '' : 's'} · passed {qr.passed}, {met ? 'met' : 'not met'}

### c0754 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:561
old: Integrity — to look at, not a verdict
new: Integrity (to look at, not a verdict)

### c0756 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:604
old: Someone else changed this grade meanwhile — showing theirs.
new: Someone else changed this grade meanwhile. Their grade is shown.

### c0758 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:632
old: Why override the autograde? (required; the student sees it on release — no medical or accommodation details)
new: Why override the autograde? (required, shown to the student on release, no medical or accommodation details)

### c0759 · REWRITE · suggested
where: Grading › submission page · app/src/instructor/StudentSubmissionView.tsx:633
old: Feedback note (optional; the student sees it on release — no medical or accommodation details)
new: Feedback note (optional, shown to the student on release, no medical or accommodation details)

### c0765 · REWRITE · suggested
where: Grading tab (course list) · app/src/instructor/GradingTab.tsx:33
old: Every assignment's grading status. The latest submission counts; a grade is 40 + 60·P, less any late deduction.
new: The latest submission counts. A grade is 40 + 60·P, less any late deduction.

### c0766 · REWRITE · suggested
where: Grading tab (course list) · app/src/instructor/GradingTab.tsx:64
old: Couldn’t load grading — the server may be unreachable. ‹button›
new: Couldn’t load grading. The server may be unreachable. ‹button›

### c0769 · REWRITE · suggested
where: Grading tab (course list) · app/src/instructor/GradingTab.tsx:144
old: * provisional — hand grading still pending. Submitted, missing and the mean count roster students only.
new: * provisional (hand grading still pending). Submitted, missing and the mean count roster students only.

### c0771 · REWRITE · suggested
where: Grading tab (course list) · app/src/instructor/GradingTab.tsx:220
old: Flags are prompts to look, never verdicts — over published assignments. Hover a flag for its detail; the thresholds are in Settings.
new: Flags are prompts to look, not verdicts. They cover published assignments. Hover a flag for its detail. The thresholds are in Settings.

### c0776 · REWRITE · suggested
where: Grading tab (course list) · app/src/instructor/GradingTab.tsx:249
old: Couldn’t save — the server may be unreachable.
new: Couldn’t save. The server may be unreachable.

### c0779 · REWRITE · suggested
where: Notes tab · app/src/instructor/NotesView.tsx:64
old: Could not save — the server may be unreachable.
new: Could not save. The server may be unreachable.

### c0782 · REWRITE · suggested
where: Notes tab · app/src/instructor/NotesView.tsx:97
old: Markdown — headings, lists, links, bold/italic, code…
new: Markdown: headings, lists, links, bold/italic, code…

### c0794 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:679
old: Max tape cells ‹input› blank = unbudgeted; counts the span of cells the head occupies
new: Max tape cells ‹input› blank = no limit. Counts the span of cells the head occupies.

### c0796 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:708
old: blank = 0 or 1 only; a number K gives ½ when at least K cases pass
new: blank = 0 or 1 only. A number K gives ½ when at least K cases pass.

### c0798 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:710
old: (N is set when the bank is built at save)
new: (N is set when you save)

### c0799 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:715
old: An open question is answered in free text and is not autograded — review the responses in the gradebook. (LLM-assisted grading may plug in here later.)
new: An open question is answered in free text and is not autograded. Grade the responses by hand under Grading.

### c0800 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:742
old: The student fills a blank table — the arguments as well as the values — and it is autograded as a function: each key row passes when exactly one of the student&#8217;s rows has its arguments and that row&#8217;s values match. Row order never matters, empty rows are ignored, and two rows with the same arguments fail that key row. Cells compare as blanks do (surrounding spaces and leading zeros ignored); a digits-only column refuses every other character. With no key rows at all it is graded by hand instead (type the rows students see).
new: The student fills a blank table, the arguments as well as the values. It is autograded as a function. Each key row passes when exactly one of the student&#8217;s rows has its arguments and that row&#8217;s values match. Row order does not matter, empty rows are ignored, and two rows with the same arguments fail that key row. Cells compare as blanks do (surrounding spaces and leading zeros ignored). A digits-only column refuses every other character. With no key rows at all, it is graded by hand instead (type the rows students see).

### c0801 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:763
old: The student invents a symbol for each digit of the base, typed in a box labelled with its meaning, then writes each number below in that system. There is no answer key: it is autograded by rule, against the student&#8217;s own symbols. A symbol passes when it is one character (an emoji counts as one), not a digit 0&#8211;9, and unlike the other symbols (&#8220;a&#8221; and &#8220;A&#8221; differ); a number passes when it is exactly the student&#8217;s symbols for its digits in the base (spaces ignored), and those symbols pass. Answers match boxes by position: once students have started, keep the base, relabel numbers in place and add new ones at the end.
new: The student invents a symbol for each digit of the base, typed in a box labelled with its meaning, then writes each number below in that system. There is no answer key. It is autograded by rule, against the student&#8217;s own symbols. A symbol passes when it is one character (an emoji counts as one), not a digit 0&#8211;9, and unlike the other symbols (&#8220;a&#8221; and &#8220;A&#8221; differ). A number passes when it is exactly the student&#8217;s symbols for its digits in the base (spaces ignored), and those symbols pass. Answers match boxes by position. Once students have started, keep the base, relabel numbers in place and add new ones at the end.

### c0802 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:786
old: The student types an answer into each labelled blank, and it is autograded by string comparison — surrounding spaces and leading zeros are ignored (&#8220;0011&#8221; matches &#8220;11&#8221;). A digits-only blank refuses every other character. Answers match blanks by position: once students have started, relabel blanks in place and add new ones at the end.
new: The student types an answer into each labelled blank, and it is autograded by string comparison. Surrounding spaces and leading zeros are ignored (&#8220;0011&#8221; matches &#8220;11&#8221;). A digits-only blank refuses every other character. Answers match blanks by position. Once students have started, relabel blanks in place and add new ones at the end.

### c0803 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:847
old: ‹input› Restrict available components (students may build only with the checked components; inputs and outputs are always available, and boxed circuits may not contain anything else)
new: ‹input› Restrict available components (only the checked ones, plus inputs and outputs, may be used, including inside boxed circuits)

### c0804 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:881
old: ‹input› Limit how many components may be used (leave a box blank for no cap; components inside boxed circuits are counted too)
new: ‹input› Limit how many components may be used (a blank box means no limit, and components inside boxed circuits count too)

### c0809 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:1032
old: The first part of a problem: {ownParts.map((q) => q.label).join(', ')} {ownParts.length === 1 ? 'is a later p…}. Its stem and closing are the problem&#8217;s.
new: This question is the first part of a problem. {ownParts.map((q) => q.label).join(', ')} {ownParts.length === 1 ? 'is a later p…}. Its stem and closing are the problem&#8217;s.

### c0813 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:1050
old: A part shows on its problem&#8217;s page, after the problem&#8217;s earlier parts — keep it directly after them in the list, in the same section. It is still graded on its own (1 point).
new: A part shows on its problem&#8217;s page, after the problem&#8217;s earlier parts. Keep it directly after them in the list, in the same section. It is still graded on its own (1 point).

### c0814 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:1058
old: Stem (optional) — the problem&#8217;s text before its parts
new: Stem: the problem&#8217;s text before its parts (optional)

### c0815 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:1062
old: Closing (optional) — the problem&#8217;s text after its parts
new: Closing: the problem&#8217;s text after its parts (optional)

### c0822 · REWRITE · suggested
where: Question creator · app/src/instructor/QuestionCreator.tsx:1106
old: Math goes in LaTeX between dollar signs ($x + 1$, or $$…$$ on its own line); machine literals go in `backticks`; **bold** and *italic* work too. A blank line starts a new paragraph.
new: Math goes in LaTeX between dollar signs ($x + 1$, or $$…$$ on its own line). Machine literals go in `backticks`. **bold** and *italic* work too. A blank line starts a new paragraph.

### c0840 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/fillInAuthoring.ts:160
old: Answers students have already given to {which} will now sit beside a different blank, or be dropped, and be graded there — answers match blanks by position. Relabel blanks in place and add new ones at the end to keep those answers lined up.
new: Answers students have already given to {which} will now sit beside a different blank, or be dropped, and be graded there. Relabel blanks in place and add new ones at the end to keep those answers lined up.

### c0841 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/fillInAuthoring.ts:329
old: Give the table at least two columns — an argument and a value.
new: Give the table at least two columns (an argument and a value).

### c0848 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/fillInAuthoring.ts:350
old: Students need at least {draft.keyRows.length} rows — one for each key row.
new: Students need at least {draft.keyRows.length} rows (one for each key row).

### c0854 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/fillInAuthoring.ts:407
old: {lead} will be read as something else, or dropped — they are stored cell by cell, row by row. Keep the question a table to keep them.
new: {lead} will be read as something else, or dropped. Keep the question a table to keep them.

### c0855 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/fillInAuthoring.ts:413
old: {lead} will shift into other columns — they are stored row by row, so adding, removing or reordering columns misreads every row. Rename columns in place to keep them lined up.
new: {lead} will shift into other columns. To keep them lined up, rename columns in place instead of adding, removing or reordering them.

### c0856 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/fillInAuthoring.ts:419
old: {lead} past row {nextRows} will be dropped — students saw {savedRows} rows. Keep at least {savedRows} to keep them.
new: {lead} past row {nextRows} will be dropped. Students saw {savedRows} rows. Keep at least {savedRows} to keep them.

### c0859 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/fillInAuthoring.ts:524
old: needs a value — a whole number, 0 or more
new: needs a value (a whole number, 0 or more)

### c0862 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/fillInAuthoring.ts:589
old: {lead} will be read as something else, or dropped — they are stored box by box. Keep the question a numeral to keep them.
new: {lead} will be read as something else, or dropped. Keep the question a numeral to keep them.

### c0863 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/fillInAuthoring.ts:593
old: {lead} will shift — the base sets how many symbol boxes come first and what each one means, so every symbol and number answer moves. Keep the base to keep them lined up.
new: {lead} will shift. Changing the base moves every symbol and number answer. Keep the base to keep them lined up.

### c0864 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/fillInAuthoring.ts:598
old: {lead} for {moved.join(', ')} will now sit beside a different number, or be dropped — answers match boxes by position. Relabel numbers in place and add new ones at the end.
new: {lead} for {moved.join(', ')} will now sit beside a different number, or be dropped. Relabel numbers in place and add new ones at the end.

### c0873 · REWRITE · suggested
where: Question creator › fill-in · app/src/instructor/FillInTableEditor.tsx:151
old: Key — one row per case, any order
new: Key (one row per case, any order)

### c0881 · REWRITE · suggested
where: Question creator › formula errors · app/src/engine/formulaEval.ts:98
old: Formula produced a negative result ({result}); circuits cannot represent negative numbers
new: Formula produced a negative result ({result}), which circuits cannot represent

### c0893 · REWRITE · suggested
where: Question creator › perception · app/src/instructor/perceptionAuthoring.ts:167
old: A {mode} perception bank already covers every input — remove the {draft.films.length} film{draft.films.length === 1 ? '' : 's'} (films are for SC rules).
new: A {mode} perception bank already covers every input. Remove the {draft.films.length} film{draft.films.length === 1 ? '' : 's'} (films are for SC rules).

### c0895 · REWRITE · suggested
where: Question creator › perception · app/src/instructor/PerceptionEditor.tsx:87
old: — one frame per clock tick —
new: (one frame per clock tick)

### c0901 · REWRITE · suggested
where: Question creator › perception · app/src/instructor/PerceptionEditor.tsx:183
old: Grading bank: {summary.generated} generated case{summary.generated === 1 ? '' : 's'} {summary.authored > 0 && ` + ${summary…} — {summary.positives} with an expected 1 somewhere {summary.examples > 0 && ` · ${summary…}.
new: Grading bank: {summary.generated} generated case{summary.generated === 1 ? '' : 's'} {summary.authored > 0 && ` + ${summary…}, {summary.positives} with an expected 1 somewhere {summary.examples > 0 && ` · ${summary…}.

### c0904 · REWRITE · suggested
where: Question creator › perception · app/src/instructor/PerceptionEditor.tsx:207
old: Frame sequences of your own, graded after the generated ones — every step, like theirs. The expected output is always the rule's. Students see only the films marked "Example for students" (with their expected output) before grading; the rest stay hidden in the grading bank.
new: Frame sequences of your own, graded at every step after the generated ones. The expected output is always the rule's. Students see only the films marked "Example for students" (with their expected output) before grading. The rest stay hidden.

### c0911 · REWRITE · suggested
where: Question creator › turbot arenas · app/src/instructor/TurbotArenasEditor.tsx:104
old: The brain is graded in every arena, each by its own success criterion and step budget, and the question passes only if every arena passes — so a family of arenas rejects a brain that only works in one. Students see arena #1 on the problem page and in the Map; a failed arena can be replayed from their grade sheet.
new: The brain is graded in every arena, each by its own success criterion and step budget. The question passes only if every arena passes. Students see arena #1 on the problem page and in the Map. They can replay a failed arena from their grade sheet.

### c0913 · REWRITE · suggested
where: Question creator › turbot arenas · app/src/instructor/TurbotArenasEditor.tsx:204
old: Click cells to paint with the selected tool. With the Turbot tool, click a cell to move the start there; click the turbot again to rotate it.
new: Click cells to paint with the selected tool. With the Turbot tool, click a cell to move the start there. Click the turbot again to rotate it.

### c0920 · REWRITE · suggested
where: Question creator › turbot arenas · app/src/instructor/turbotCaseAuthoring.ts:50
old: The turbot must end on its starting cell — first visiting a goal cell, if the arena has one.
new: The turbot must end on its starting cell, after visiting a goal cell if the arena has one.

### c0924 · REWRITE · suggested
where: Question creator › turbot arenas · app/src/instructor/turbotCaseAuthoring.ts:190
old: Runs already graded in {which} will now be listed in the gradebook, and replayed by students' "Run this input", against a different arena, or none — graded runs match arenas by position. To keep each run beside the arena it was graded in, add new arenas at the end instead of moving, removing or inserting one.
new: Runs already graded in {which} will now be listed in the gradebook, and replayed by students' "Run this input", against a different arena, or none. To keep each run beside the arena it was graded in, add new arenas at the end instead of moving, removing or inserting one.

### c0925 · REWRITE · suggested
where: Robot tab · app/src/instructor/RobotView.tsx:62
old: Couldn’t refresh ({error.message}) — showing the last answer.
new: Couldn’t refresh ({error.message}). Showing the last answer.

### c0928 · REWRITE · suggested
where: Robot tab · app/src/instructor/RobotView.tsx:94
old: the server’s start — its clone keeps no release time
new: the server’s start

### c0935 · REWRITE · suggested
where: Robot tab · app/src/instructor/RobotView.tsx:174
old: {review.items.length} {review.items.length === 1 ? 'report w…} for your call — Feedback tab
new: {review.items.length} {review.items.length === 1 ? 'report w…} for your call in the Feedback tab

### c0952 · REWRITE · suggested
where: Robot tab (server facts) · server/src/robotStatus.ts:213
old: no mirror of GitHub main: an in-memory database has no data folder to keep one in (set MM_REPO_MIRROR)
new: no mirror of GitHub main, since an in-memory database has no data folder to keep one in (set MM_REPO_MIRROR)

### c0960 · REWRITE · suggested
where: Robot tab (server facts) · server/src/robotStatus.ts:312
old: no backups folder: an in-memory database has none (set MM_BACKUP_DIR)
new: no backups folder, since an in-memory database has none (set MM_BACKUP_DIR)

### c0969 · REWRITE · suggested
where: Robot tab (server facts) · server/src/robotStatus.ts:405
old: not asked: nothing new to ship
new: not asked (nothing new to ship)

### c0970 · REWRITE · suggested
where: Robot tab (server facts) · server/src/robotStatus.ts:405
old: not asked: what the pilot runs is unknown
new: not asked (what the pilot runs is unknown)

### c0972 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/rosterReportText.ts:19
old: no longer on the class list — review
new: no longer on the class list

### c0973 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:34
old: The roster lives on the server. This build runs in local mode, where the two demo accounts are built in — there is nothing to manage here.
new: The roster lives on the server. This build runs in local mode, where the two demo accounts are built in. There is nothing to manage here.

### c0979 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:116
old: Nobody on the roster yet — import the class CSV above.
new: Nobody on the roster yet. Import the class CSV above.

### c0984 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:185
old: {alias} no longer signs in, and the password set up through it is cleared — {row.name} sets up their account again.
new: {alias} no longer signs in, and the password set up through it is cleared. {row.name} sets up their account again.

### c0986 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:200
old: Typed into an access request; not from the class list
new: Typed into an access request, not from the class list

### c0987 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:219
old: Reset the password for {row.email}? Their password is cleared and they are signed out everywhere. They set up their account again with their student ID; their work is untouched.
new: Reset the password for {row.email}? Their password is cleared and they are signed out everywhere. They set up their account again with their student ID. Their work is untouched.

### c0988 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:225
old: Password reset for {row.email} — they can create their account again.
new: Password reset for {row.email}. They can create their account again.

### c0992 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:286
old: The registrar's class-list export works as-is: its heading lines are skipped, names are put in display form, and the section is kept; dropped students are left out, waitlisted ones are imported. Any other export with an email column works too — name, student ID and role are picked up when present. Importing only adds and updates: nobody is removed, and nobody's password is touched, so a mid-quarter re-import is safe.
new: The registrar's class-list export works as-is. Dropped students are left out and waitlisted ones are imported. Any other export with an email column works too (name, student ID and role are read when present). Importing only adds and updates. Nobody is removed and no password is touched, so a mid-quarter re-import is safe.

### c0994 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:325
old: Columns used — email: {c.email ?? '(none)'} · name: {c.name ?? '(none)'} · ID: {c.studentId ?? '(none)'} · role: {c.role ?? '(none)'} · section: {c.section ?? '(none)'} · status: {c.status ?? '(none)'}
new: Columns used. Email: {c.email ?? '(none)'} · name: {c.name ?? '(none)'} · ID: {c.studentId ?? '(none)'} · role: {c.role ?? '(none)'} · section: {c.section ?? '(none)'} · status: {c.status ?? '(none)'}

### c0995 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:348
old: {sentenceCase(NO_LONGER_LISTED_TEXT)} ({report.noLongerListed.length}). Nobody was removed: remove someone below once you have checked they left the course.
new: {sentenceCase(NO_LONGER_LISTED_TEXT)} ({report.noLongerListed.length}). Nobody was removed. Remove someone below after checking they left the course.

### c0997 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:379
old: People the roster doesn't have, asking to be added. Approving adds them — they then create their account the same way everyone else does. When a request's ID or email is already on the roster, approving adds its email to that person's account instead.
new: Approving a request adds the person to the roster. They then create their account like everyone else. If the request's ID or email is already on the roster, approving adds its email to that person's account instead.

### c1001 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:469
old: {added} is on the roster — they can now create their account.
new: {added} is on the roster. They can now create their account.

### c1002 · REWRITE · suggested
where: Roster & accounts tab · app/src/instructor/RosterView.tsx:471
old: Updated {placed.account} — {placed.aliasAdded} now signs in to that account too.
new: Updated {placed.account}. {placed.aliasAdded} now signs in to that account too.

### c1011 · REWRITE · suggested
where: Roster import report (server) · server/src/roster.ts:567
old: unrecognised status "{statusCell}" — imported
new: unrecognised status "{statusCell}" (imported)

### c1013 · REWRITE · suggested
where: Roster import report (server) · server/src/rosterImport.ts:52
old: {placed.reason} — row not imported
new: {placed.reason} (row not imported)

### c1018 · REWRITE · suggested
where: Server replies · server/src/app.ts:621
old: students have submitted this assignment — hide it instead of deleting it
new: students have submitted this assignment. Hide it instead of deleting it

### c1020 · REWRITE · suggested
where: Server replies · server/src/app.ts:702
old: snapshot failed; nothing re-graded
new: snapshot failed, so nothing was re-graded
