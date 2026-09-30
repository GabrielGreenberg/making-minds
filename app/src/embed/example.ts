// The embed's example (task 087): which one the URL names, fetching it, and
// opening it — one sandbox workbook file (task 028's format) from
// public/embed-examples/, holding exactly one worksheet.
//
// Opening goes through the store's importWorkbook, the File menu's Open path,
// so a load or a Reset is a canvas swap like any other: resetAllSimState and
// a cleared undo/redo come with it (law 6), and nothing here builds a canvas
// of its own.

import type { BuildMode } from '../types';
import { parseWorkbookFile } from '../workbookFile';
import { useStore } from '../store';

/** The example an embed shows when the URL names none (or one that fails). */
export const DEFAULT_EXAMPLE = 'majority';

/** An example's name: lowercase letters, digits and hyphens — a file name,
 *  never a path. */
const EXAMPLE_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** The example `?example=<name>` names, else the default. */
export function exampleNameFrom(search: string): string {
  const name = new URLSearchParams(search).get('example');
  return name != null && EXAMPLE_NAME.test(name) ? name : DEFAULT_EXAMPLE;
}

/** Where an example's files are served from: the build's base (the Vite
 *  base is '/making-minds/' in dev and CI, '/' on Pages). `?.`: under tsx
 *  (the harness) import.meta.env is undefined. */
export function exampleUrl(name: string, ext: 'json' | 'png' = 'json'): string {
  return `${import.meta.env?.BASE_URL ?? '/'}embed-examples/${name}.${ext}`;
}

export interface LoadedExample {
  /** The example actually loaded — the default when the named one failed. */
  name: string;
  /** The workbook file's text, kept for Reset. */
  text: string;
  title: string;
  buildMode: BuildMode;
  /** A turbot example's arena size (the Map's cells are sized to it). */
  arena?: { width: number; height: number };
}

/** The slice of fetch this needs (the harness passes a fake). */
export type FetchText = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;

/**
 * Fetch and check the example `name`; on ANY failure — the network, a 404,
 * or a file that is not one worksheet's workbook (Pages answers an unknown
 * path with the app's index.html and a 200) — the default example instead.
 * Rejects only when the default fails too.
 */
export async function loadExample(name: string, fetchText: FetchText = (url) => fetch(url)): Promise<LoadedExample> {
  const tryOne = async (n: string): Promise<LoadedExample | null> => {
    try {
      const res = await fetchText(exampleUrl(n));
      if (!res.ok) return null;
      const text = await res.text();
      const parsed = parseWorkbookFile(text);
      if (!parsed.ok || parsed.workbook.worksheets.length !== 1) return null;
      const [sheet] = parsed.workbook.worksheets;
      return {
        name: n,
        text,
        title: parsed.workbook.metadata.title || sheet.title,
        buildMode: sheet.buildMode,
        ...(sheet.arena ? { arena: { width: sheet.arena.width, height: sheet.arena.height } } : {}),
      };
    } catch {
      return null;
    }
  };
  const loaded = (await tryOne(name)) ?? (name === DEFAULT_EXAMPLE ? null : await tryOne(DEFAULT_EXAMPLE));
  if (!loaded) throw new Error(`The example “${name}” could not be loaded.`);
  return loaded;
}

/** What an FSM example is fed, so Run shows something at once: a stream the
 *  visitor can retype in the output panel. */
export const DEMO_FSM_INPUT: readonly number[] = [1, 0, 1, 1, 0, 1];

/**
 * Open (or re-open: Reset) an example's text as the only tab — through the
 * File menu's Open path — then seed its demo input. Throws on a file that
 * does not parse (loadExample has already checked it).
 */
export function openExample(text: string): void {
  const opened = useStore.getState().importWorkbook(text);
  if (!opened.ok) throw new Error(opened.reason);
  const s = useStore.getState();
  if (s.buildMode === 'FSM') s.setFsmInputSequence([...DEMO_FSM_INPUT]);
}
