// The DOM adapter of the provenance seam (provenance.ts; law 8): the ONE guard
// every assignment answer field wears — open response, fill-in blanks, box
// rename — and the ONLY file allowed to touch the clipboard APIs (grep gate in
// tools/pasteCheck.ts). The policy lives in provenance.ts; this file only
// turns DOM events into questions for it.
//
// In the sandbox it does nothing: the browser copies and pastes natively. In
// an assignment (the scope is read from the store at EVENT time):
//   copy / cut   — cancelled; '' goes to the system clipboard (nothing leaves
//                  an assignment) beside the copy's opaque id (CLIP_MARKER_TYPE),
//                  and the selection is stamped into the seam's text slot. With
//                  nothing selected the slot keeps its item and the id written
//                  is that item's. A cut then deletes the selection itself,
//                  unless the field is read-only (locked or frozen: a cut copies).
//   paste        — always cancelled. When textPasteVerdict allows it, the
//                  SLOT's text is inserted, never the system clipboard's; the
//                  system clipboard is read only to tell whether the slot's item
//                  is still the latest copy (its id, or anything else there).
//   drop / drag  — cancelled, with a notice.
//   beforeinput  — the paste-like input types (guardedInputType: paste, drop,
//                  yank, link, drag-delete) are refused, which also covers the
//                  context menu and mobile paste paths that skip `paste`.
//                  Typing, spell-check replacements and deletes pass — and so
//                  does our own execCommand('insertText').
// Native listeners, not React props: React's onBeforeInput carries no
// inputType. The ref is a React 19 callback ref returning its cleanup, stable
// across renders, so one guard can serve several inputs (a Worksheet page's fields).
// The text setters stay lock-gated in the store (law 3); a read-only field
// here just never inserts.
//
// useImagePaste (task 088) is the one other clipboard read: a pasted image
// becomes a Feedback screenshot. See its comment for why it asks no verdict.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, selectPasteScope } from './store';
import {
  CLIP_MARKER_TYPE,
  currentProvenance,
  guardedInputType,
  peekClipboard,
  refusalMessage,
  stampText,
  textPasteVerdict,
  type PasteScope,
  type SystemClipboard,
} from './provenance';

type TextField = HTMLInputElement | HTMLTextAreaElement;

/** How long a notice stays up. */
export const NOTICE_MS = 4000;

/** A transient one-line notice (a refused paste's explanation): the text, and
 *  a function showing a new one for NOTICE_MS. Shared by the guard and the
 *  canvas, so both behave alike. */
export function useNotice(): [string | null, (message: string) => void] {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(message);
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [notice, show];
}

function assignmentScope(): PasteScope | null {
  const scope = selectPasteScope(useStore.getState());
  return scope.kind === 'assignment' ? scope : null;
}

/** The field's selection; '' where the field has none (or no selection API). */
function selectedText(el: TextField): string {
  try {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    return el.value.slice(start, end);
  } catch {
    return '';
  }
}

/** Replace the selection with `text` as if typed: execCommand keeps the
 *  field's own undo stack and fires a React-visible input event; where it is
 *  unavailable, setRangeText plus a bubbling 'input' event does the same. */
function insertAtSelection(el: TextField, text: string): void {
  el.focus();
  if (document.execCommand('insertText', false, text)) return;
  try {
    el.setRangeText(text, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    /* no selection API on this field: leave it untouched */
  }
}

function deleteSelection(el: TextField): void {
  if (document.execCommand('delete')) return;
  insertAtSelection(el, '');
}

/** What a paste event's clipboard holds, for textPasteVerdict. */
function readSystemClipboard(data: DataTransfer | null): SystemClipboard {
  if (!data) return { text: '', marker: '', other: false };
  const types = Array.from(data.types);
  return {
    text: data.getData('text/plain'),
    marker: types.includes(CLIP_MARKER_TYPE) ? data.getData(CLIP_MARKER_TYPE) : '',
    other: types.some((t) => t !== 'text/plain' && t !== CLIP_MARKER_TYPE),
  };
}

export function usePasteGuard(onNotice?: (message: string) => void): {
  ref: (el: TextField | null) => (() => void) | undefined;
  notice: string | null;
} {
  const [notice, show] = useNotice();
  // The latest callbacks, read at event time, so the ref itself stays stable.
  const notify = useRef<(message: string) => void>(show);
  useEffect(() => {
    notify.current = (message: string) => {
      show(message);
      onNotice?.(message);
    };
  }, [show, onNotice]);

  const ref = useCallback((el: TextField | null) => {
    if (!el) return undefined;

    const copyOut = (e: ClipboardEvent, cut: boolean) => {
      const scope = assignmentScope();
      if (!scope) return;
      e.preventDefault();
      const text = selectedText(el);
      // Nothing selected: keep what was copied before, and point at it again.
      const id = text === '' ? peekClipboard().text?.id : stampText(text, currentProvenance(scope));
      e.clipboardData?.setData('text/plain', '');
      if (id) e.clipboardData?.setData(CLIP_MARKER_TYPE, id);
      if (text === '') return;
      if (cut && !el.readOnly) deleteSelection(el);
    };
    const onCopy = (e: ClipboardEvent) => copyOut(e, false);
    const onCut = (e: ClipboardEvent) => copyOut(e, true);

    const onPaste = (e: ClipboardEvent) => {
      const scope = assignmentScope();
      if (!scope) return;
      e.preventDefault();
      if (el.readOnly) return;
      const system = readSystemClipboard(e.clipboardData);
      const verdict = textPasteVerdict(peekClipboard().text, currentProvenance(scope), system);
      if (!verdict.ok) {
        notify.current(verdict.message);
        return;
      }
      if (!verdict.native) insertAtSelection(el, verdict.text);
    };

    const onDrag = (e: DragEvent) => {
      if (!assignmentScope()) return;
      e.preventDefault();
      notify.current(refusalMessage('drag'));
    };

    const onBeforeInput = (e: InputEvent) => {
      if (!assignmentScope() || !guardedInputType(e.inputType)) return;
      e.preventDefault();
      notify.current(refusalMessage(e.inputType.includes('Drop') || e.inputType.includes('Drag') ? 'drag' : 'outside'));
    };

    // One event map for both field types (a union loses addEventListener's).
    const target: HTMLElement = el;
    target.addEventListener('copy', onCopy);
    target.addEventListener('cut', onCut);
    target.addEventListener('paste', onPaste);
    target.addEventListener('drop', onDrag);
    target.addEventListener('dragstart', onDrag);
    target.addEventListener('beforeinput', onBeforeInput);
    return () => {
      target.removeEventListener('copy', onCopy);
      target.removeEventListener('cut', onCut);
      target.removeEventListener('paste', onPaste);
      target.removeEventListener('drop', onDrag);
      target.removeEventListener('dragstart', onDrag);
      target.removeEventListener('beforeinput', onBeforeInput);
    };
  }, []);

  return { ref, notice };
}

/** What imageFilesOf reads off a clipboard: a DataTransfer, or pasteCheck's
 *  fakes (hence generic over the file type). */
export interface ClipboardFiles<F extends { type: string }> {
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): F | null }> | null;
  files?: ArrayLike<F> | null;
  types?: ArrayLike<string> | null;
}

/** Does the clipboard carry plain text? Its `types` or a string item say so
 *  (Safari can leave `items` empty). */
function hasPlainText(data: ClipboardFiles<{ type: string }>): boolean {
  if (Array.from(data.types ?? []).includes('text/plain')) return true;
  return Array.from(data.items ?? []).some((item) => item.kind === 'string' && item.type === 'text/plain');
}

const NON_TEXT_INPUTS = new Set(['file', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'range', 'color']);

/** A paste target that takes typed text: a textarea, a text-like input,
 *  anything contentEditable. Not a file picker, a checkbox or a button. */
function takesText(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && !NON_TEXT_INPUTS.has(typeof el.type === 'string' ? el.type.toLowerCase() : 'text');
}

/** The image files on a clipboard: its file items whose type is image/*.
 *  Only when the items yield none are its `files` read (Safari can leave
 *  `items` empty). Text, HTML and non-image files are never taken. */
export function imageFilesOf<F extends { type: string }>(data: ClipboardFiles<F> | null | undefined): F[] {
  if (!data) return [];
  const isImage = (type: string) => type.startsWith('image/');
  const fromItems: F[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !isImage(item.type)) continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  if (fromItems.length > 0) return fromItems;
  return Array.from(data.files ?? []).filter((f) => isImage(f.type));
}

/** A paste event's images, taken: the event is cancelled only when it holds
 *  at least one, so a text paste goes on as typed. Into a text field, a
 *  clipboard that also holds plain text is the text's (Office apps put a
 *  picture of copied cells beside them): nothing is taken and the text goes
 *  in. An image with no plain text (a screenshot, a copied web image) is
 *  taken wherever it lands. An event already cancelled (an assignment answer
 *  field's guard took it) is left alone. */
export function takeImagePaste<F extends { type: string }>(e: {
  defaultPrevented: boolean;
  clipboardData: ClipboardFiles<F> | null;
  target?: unknown;
  preventDefault(): void;
}): F[] {
  if (e.defaultPrevented || !e.clipboardData) return [];
  if (takesText(e.target) && hasPlainText(e.clipboardData)) return [];
  const files = imageFilesOf(e.clipboardData);
  if (files.length > 0) e.preventDefault();
  return files;
}

/**
 * While `enabled`, a pasted image anywhere on the page goes to `onImages`
 * (the Feedback form's screenshots). Text pastes pass untouched, and so does
 * text-with-a-picture pasted into a text field (takeImagePaste).
 *
 * No provenance verdict is asked, on purpose: a Feedback report is a note
 * to the instructors, not assignment content, and its message box is
 * already a counted exemption in pasteCheck. Law 8 is about answers.
 */
export function useImagePaste(onImages: (files: File[]) => void, enabled: boolean): void {
  // The latest callback, read at event time, so the listener stays put.
  const latest = useRef(onImages);
  useEffect(() => {
    latest.current = onImages;
  });
  useEffect(() => {
    if (!enabled) return;
    const onImagePaste = (e: ClipboardEvent) => {
      const files = takeImagePaste(e);
      if (files.length > 0) latest.current(files);
    };
    document.addEventListener('paste', onImagePaste);
    return () => document.removeEventListener('paste', onImagePaste);
  }, [enabled]);
}
