# Legacy list (moved from todos/fixes.md on 2026-09-21)

Most of these shipped in the 2026-09-10 pass (see docs/HISTORY.md). The catcher should
verify each remaining item against the code before filing it or discarding it. Items
known NOT to be confirmed in the changelog: the off-center question-pane resize grabber,
the "Swap state type" button rename, the misaligned Submit button vs "submitted <date>".

- In question descriptions in editor: if a particular input-output behavior is described, format as a table rather than inline for readability.
- If a question has a title, it should be in bold and on its own line.
- The grabbable component for resizing the question pane is not centered on the pane boundary. It's a couple pixels to the right.
- Some questions (e.g. 1.2, 2.6) constrain the type or number of circuit components that can be used. The autograder should check for these constraints, and the question editor should provide an interface for specifying these constraints.
- Question hints should be marked in a distinctive color and italicized. They should be on their own line
- When placing a circuit component, the current component should stay selected so several copies can easily be placed. Right-clicking should unselect the component, as should clicking on the component icon in the component bar.
- remove the argument/value component of the right bar
- persist boxed circuits across exercises of the same type. So a boxed CC should be usable on any CC question within the same homework.
- Short answer questions with several parts (a, b...) should have each part on a separate line.
- Homework 1 question 11 should be autograded. Format the student side as a list of text entry boxes, each labled with a number from 0 through 10. The text entry should only allow numbers. The server-side should just compare each answer to the correct text string, stripped of leading zeros. No need to provide a special instructor-side facility for creating this question, just hard-code it for now.
- mathematical symbols in question descriptions should be formatted in latex. Code and the like should also be formatted as usual (in backticks)
- the submission button on the assignment page (when viewing a particular assignment, not when viewing the list of all assignments) is misaligned with the "submitted <date>" confirmation message.
- instructor view of assignments should allow for re-ordering assignments.
- instructor view should have a button for making assignments visible/invisible (i.e. a release button)
- to view their grades, students should be able to open a window with a table mapping each question to the grade they got on the question.
- the turbot editor map should be more ergonomic. In particular, it should allow for easy zooming.
- the map in the turbot editor should go below the vocab/state glossary
- the editor should display the full name of the current assignment.
- the "In/External" button in the Turbot editor should be "Swap state type"
- question 2 on homework 6 states that the solution should use at most 20 cells of tape. Make sure the autograder tests for this, and modify the question editor to allow the instructor to specify a maximal number of tape cells used.
- remove the text annotations and comment features from the editor
- the main page UI (outside the editor) is currently organized around a floating, scrollable island over a static grey background. Convert to a flat UI.
- add boxing for SCs, TMs, and Turbots
