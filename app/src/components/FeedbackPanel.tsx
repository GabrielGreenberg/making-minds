import { useState } from 'react';
import type { FeedbackCategory, FeedbackContext, FeedbackScreenshot } from '../types';
import { feedbackStore } from '../storage/backend';
import { feedbackFromSession } from '../storage/feedbackStore';
import { useAuth } from '../auth';
import { useImagePaste } from '../usePasteGuard';
import { MOD_KEY } from '../shortcuts';
import { Modal } from './Modal';
import { ScreenshotSlots } from './screenshotSlots';

const MAX_SCREENSHOTS = 2;
const MAX_SIDE = 1600; // downscale so a typical screenshot lands well under 1MB
const JPEG_QUALITY = 0.7;
const LIMIT_MESSAGE = `You can attach up to ${MAX_SCREENSHOTS} screenshots. Remove one to add another.`;

/** Fired on `window` when a report is filed, so a view listing reports (the
 *  Dashboard's Feedback queue) reloads whichever entry point filed it. */
export const FEEDBACK_FILED_EVENT = 'mm:feedback-filed';

/** Downscale + re-encode a picked or pasted image into a small JPEG data URL, so a
 *  full-resolution screenshot doesn't blow the request body or (in local
 *  mode) localStorage's ~5MB budget. */
function fileToScreenshot(file: File): Promise<FeedbackScreenshot> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('could not read file'));
    reader.onload = () => {
      img.onerror = () => reject(new Error('could not decode image'));
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas unavailable')); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), filename: file.name });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The report form, the same for every role and every entry point. `context`
 * is where the reporter is, from the caller (the route —
 * routing.ts feedbackContextFor); absent = none (Home, the Dashboard). The
 * author and their role are the session's.
 */
export function FeedbackPanel({ onClose, context }: { onClose: () => void; context?: FeedbackContext }) {
  const { user } = useAuth();
  const instructor = user?.role === 'instructor';
  const [category, setCategory] = useState<FeedbackCategory>('platform design');
  const [message, setMessage] = useState('');
  const [screenshots, setScreenshots] = useState<FeedbackScreenshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Picked or pasted, the same path: at most MAX_SCREENSHOTS, each
  // downscaled. The room is claimed on arrival, not read off `screenshots`
  // (it lags a decode: screenshotSlots.ts), and anything offered and not
  // taken is said, never dropped quietly.
  const [slots] = useState(() => new ScreenshotSlots(MAX_SCREENSHOTS));
  const addFiles = async (files: File[] | FileList | null) => {
    if (!files) return;
    const list = Array.from(files);
    const { take, overLimit } = slots.claim(list.length);
    setError(overLimit ? LIMIT_MESSAGE : null);
    if (take === 0) return;
    try {
      const added = await Promise.all(list.slice(0, take).map(fileToScreenshot));
      setScreenshots((s) => [...s, ...added]);
    } catch {
      slots.release(take);
      setError('Could not attach that image — try a different file.');
    }
  };
  const removeScreenshot = (i: number) => {
    slots.release(1);
    setScreenshots((all) => all.filter((_, j) => j !== i));
    setError((e) => (e === LIMIT_MESSAGE ? null : e)); // there is room again
  };
  // A pasted image (⌘V / Ctrl+V anywhere on the form) attaches like a picked one.
  useImagePaste((files) => void addFiles(files), !sent);

  const submit = async () => {
    if (!message.trim()) {
      setError('Say a little about what happened.');
      return;
    }
    if (!user) {
      setError('Sign in to send feedback.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await feedbackStore.submit(feedbackFromSession(user, { category, message, screenshots }, context));
      setSent(true);
      window.dispatchEvent(new Event(FEEDBACK_FILED_EVENT));
    } catch {
      setError('Could not send feedback — the server may be unreachable. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} busy={busy} label="Feedback">
      <div className="mm-modal-head">
        <h2>Feedback</h2>
        <button className="mm-btn mm-btn--small" onClick={onClose}>Close</button>
      </div>
      {instructor ? (
        <p className="mm-modal-sub">
          A problem or an idea about the platform or a homework? File it here — it
          joins the Feedback queue with the instructor tag.
        </p>
      ) : (
        <p className="mm-modal-sub">
          Something broken, confusing, or wrong in a homework? Tell the instructors.
          This form is for the platform and the homeworks only: for anything personal
          (an extension, an absence, a grade), email your instructor instead.
        </p>
      )}
      {sent ? (
        <p className="feedback-sent">
          {instructor ? 'Filed — it’s in the Feedback queue.' : 'Thanks — an instructor will take a look.'}
        </p>
      ) : (
        <div className="mm-form">
          <label className="mm-field">
            <span>Category</span>
            <select
              className="mm-input"
              value={category}
              onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
            >
              <option value="platform design">Platform design</option>
              <option value="homework content">Homework content</option>
            </select>
          </label>
          <label className="mm-field">
            <span>What happened?</span>
            <textarea
              className="mm-input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the issue or suggestion…"
              rows={5}
            />
          </label>
          <label className="mm-field">
            <span>Screenshots (optional, up to {MAX_SCREENSHOTS})</span>
            <input
              className="feedback-file"
              type="file"
              accept="image/*"
              multiple
              disabled={screenshots.length >= MAX_SCREENSHOTS}
              onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
            />
          </label>
          <p className="mm-note feedback-paste-hint">Paste a screenshot ({MOD_KEY}V) or choose a file.</p>
          {screenshots.length > 0 && (
            <div className="feedback-screenshots">
              {screenshots.map((s, i) => (
                <div key={i} className="feedback-screenshot-preview">
                  <img className="feedback-screenshot-thumb" src={s.dataUrl} alt={s.filename ?? 'screenshot'} />
                  <button
                    className="mm-btn mm-btn--small"
                    onClick={() => removeScreenshot(i)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && <p className="mm-error">{error}</p>}
          <div className="mm-actions">
            <button className="mm-btn mm-btn--primary" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
