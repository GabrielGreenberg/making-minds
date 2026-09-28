# A robot status panel in the instructor view (Gabriel, 2026-09-28)

Gabriel, in the 043 session on the robot: the robot's push notifications can't reach him
(his phone isn't on this Claude account, so Remote Control is no answer). Instead, the
instructor's view of the app should show what the robot is doing and what waits on him —
so he learns about a held release or a parked question by opening the Dashboard, not by
asking a Claude session.

What he wants to see, in plain words:
- **What's live** — which version the pilot runs, and since when.
- **What's waiting for his release**, and why in one line ("3 tasks — they change the
  database"). 2026-09-27/28: seven landed tasks sat unreleased for a day, held by the gate
  (schema, sanitize, homework content), and nobody told him.
- **What's waiting for his answer** — parked tasks (`blocked/`) with their first question,
  student fix reports waiting for his yes, `review` marks.
- **What the robot did lately** — tasks landed or parked, with times.

Notes from the session, for the catcher to verify, not settled design:
- No phone, no new account, no new secret if it can be helped. The box already holds a
  clone of the repo (`/srv/making-minds/repo`, pulled at every release), so the server may
  be able to work most of this out itself: its own HEAD vs `origin/main` after a fetch, the
  `tasks: land` subjects in between, the gate's hold rules (`deploy/release-gate.mjs`
  `decide`), and `tasks/blocked/`. Whether the server should fetch, and how often, is a
  design question.
- Instructor-only, like the Feedback tab. Task files are de-identified already, but no
  report text or student names (PROFILE §8.9).
- A "release now" button is NOT asked for — releasing stays a hand act on the robot.
