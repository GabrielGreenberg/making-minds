// The open modals, innermost last (task 088). Pure: no React, no DOM, so the
// check tools import it as it is. components/Modal.tsx is the ONLY writer:
// each mounted modal pushes one token and pops it when it unmounts.
//
// A modal owns the keyboard. A page-level key handler (the canvas's
// shortcuts, the grading queue's keys, the sandbox's ⌘S) asks isModalOpen()
// first, so nothing happens behind an open modal. Only the top modal answers
// Escape (isTopModal), so closing a modal opened over another closes one.

const open: object[] = [];

/** A modal mounted: `token` is its own, compared by identity. */
export function pushModal(token: object): void {
  open.push(token);
}

/** A modal unmounted. Removes that token wherever it sits (unmounts can come
 *  out of order); a token not in the stack is ignored. */
export function popModal(token: object): void {
  const i = open.lastIndexOf(token);
  if (i >= 0) open.splice(i, 1);
}

/** Some modal is open over the page. */
export function isModalOpen(): boolean {
  return open.length > 0;
}

/** `token` is the innermost open modal. */
export function isTopModal(token: object): boolean {
  return open.length > 0 && open[open.length - 1] === token;
}
