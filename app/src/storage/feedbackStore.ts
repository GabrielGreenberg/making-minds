// Feedback seam (notes/todos.md item 9).
//
// A student files a report on the platform or a homework; an instructor works
// it from a queue. Mirrors the SubmissionStore/AssignmentStore pattern: one
// Promise-returning interface, a localStorage-backed Local implementation
// here, a server-backed Remote implementation in remoteStores.ts, picked by
// storage/backend.ts.

import type { FeedbackCategory, FeedbackScreenshot, FeedbackStatus, PlatformFeedback } from '../types';

export interface FeedbackStore {
  submit(input: {
    student: string;
    category: FeedbackCategory;
    message: string;
    screenshots: FeedbackScreenshot[];
    context?: { assignmentId?: string; questionId?: number };
  }): Promise<PlatformFeedback>;
  /** Instructor only. */
  list(): Promise<PlatformFeedback[]>;
  /** Instructor only. */
  setStatus(id: string, status: FeedbackStatus): Promise<void>;
}

const KEY = 'mm:feedback';

class LocalFeedbackStore implements FeedbackStore {
  private read(): PlatformFeedback[] {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? (data as PlatformFeedback[]) : [];
    } catch {
      return [];
    }
  }

  private write(all: PlatformFeedback[]): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      // localStorage full or unavailable — silent fail (matches every other
      // Local store); a screenshot-heavy report is the most likely culprit in
      // local/dev mode, which is fine since local mode never faces students.
    }
  }

  async submit(input: {
    student: string;
    category: FeedbackCategory;
    message: string;
    screenshots: FeedbackScreenshot[];
    context?: { assignmentId?: string; questionId?: number };
  }): Promise<PlatformFeedback> {
    const all = this.read();
    const record: PlatformFeedback = {
      id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      student: input.student,
      category: input.category,
      message: input.message,
      screenshots: input.screenshots,
      createdAt: new Date().toISOString(),
      status: 'open',
      context: input.context,
    };
    this.write([...all, record]);
    return record;
  }

  async list(): Promise<PlatformFeedback[]> {
    return this.read().slice().reverse(); // newest first
  }

  async setStatus(id: string, status: FeedbackStatus): Promise<void> {
    const all = this.read();
    this.write(all.map((f) => (f.id === id ? { ...f, status } : f)));
  }
}

export const localFeedbackStore: FeedbackStore = new LocalFeedbackStore();
