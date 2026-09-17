// Instructor notes seam (notes/todos.md item 12).
//
// One shared markdown document instructors use to coordinate — get/save
// rather than the list/CRUD shape of the other seams, since there is only
// ever ONE note. Mirrors the Local/Remote pattern of every other seam.

import type { InstructorNote } from '../types';

export interface NotesStore {
  /** The current note, or null if nobody has saved one yet. */
  get(): Promise<InstructorNote | null>;
  /** Overwrite the note. The caller's identity/time are stamped by whichever
   *  side owns "now" — the server remotely, this module locally. */
  save(content: string, updatedBy: string): Promise<InstructorNote>;
}

const KEY = 'mm:instructor-notes';

class LocalNotesStore implements NotesStore {
  async get(): Promise<InstructorNote | null> {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as InstructorNote) : null;
    } catch {
      return null;
    }
  }

  async save(content: string, updatedBy: string): Promise<InstructorNote> {
    const note: InstructorNote = { content, updatedAt: new Date().toISOString(), updatedBy };
    try {
      localStorage.setItem(KEY, JSON.stringify(note));
    } catch {
      // localStorage full or unavailable — silent fail, matches every other
      // Local store. Local mode has no real multi-instructor concept anyway
      // (it's the single-browser dev sandbox).
    }
    return note;
  }
}

export const localNotesStore: NotesStore = new LocalNotesStore();
