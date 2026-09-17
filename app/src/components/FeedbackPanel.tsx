import { useState } from 'react';
import type { FeedbackCategory, FeedbackScreenshot } from '../types';
import { feedbackStore } from '../storage/backend';
import { getCurrentUserEmail } from '../auth';
import { useStore } from '../store';

const MAX_SCREENSHOTS = 2;
const MAX_SIDE = 1600; // downscale so a typical screenshot lands well under 1MB
const JPEG_QUALITY = 0.7;

/** Downscale + re-encode a picked image file into a small JPEG data URL, so a
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

export function FeedbackPanel({ onClose }: { onClose: () => void }) {
  const assignment = useStore((s) => s.assignment);
  const currentQuestionIndex = useStore((s) => s.currentQuestionIndex);
  const [category, setCategory] = useState<FeedbackCategory>('platform design');
  const [message, setMessage] = useState('');
  const [screenshots, setScreenshots] = useState<FeedbackScreenshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_SCREENSHOTS - screenshots.length;
    const picked = Array.from(files).slice(0, room);
    try {
      const added = await Promise.all(picked.map(fileToScreenshot));
      setScreenshots((s) => [...s, ...added]);
    } catch {
      setError('Could not attach that image — try a different file.');
    }
  };

  const submit = async () => {
    if (!message.trim()) {
      setError('Say a little about what happened.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await feedbackStore.submit({
        student: getCurrentUserEmail(),
        category,
        message: message.trim(),
        screenshots,
        context: assignment
          ? {
              assignmentId: assignment.id,
              questionId: assignment.questions[currentQuestionIndex]?.id,
            }
          : undefined,
      });
      setSent(true);
    } catch {
      setError('Could not send feedback — the server may be unreachable. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title">Feedback</h2>
          <button className="menu-link-button" onClick={onClose}>Close</button>
        </div>
        {sent ? (
          <p className="feedback-sent">Thanks — an instructor will take a look.</p>
        ) : (
          <div className="feedback-form">
            <label className="feedback-field">
              <span>Category</span>
              <select
                className="instructor-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
              >
                <option value="platform design">Platform design</option>
                <option value="homework content">Homework content</option>
              </select>
            </label>
            <label className="feedback-field">
              <span>What happened?</span>
              <textarea
                className="feedback-textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe the issue or suggestion…"
                rows={5}
              />
            </label>
            <label className="feedback-field">
              <span>Screenshots (optional, up to {MAX_SCREENSHOTS})</span>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={screenshots.length >= MAX_SCREENSHOTS}
                onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
              />
            </label>
            {screenshots.length > 0 && (
              <div className="feedback-screenshots">
                {screenshots.map((s, i) => (
                  <div key={i} className="feedback-screenshot-preview">
                    <img className="feedback-screenshot-thumb" src={s.dataUrl} alt={s.filename ?? 'screenshot'} />
                    <button
                      className="menu-link-button"
                      onClick={() => setScreenshots((all) => all.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {error && <p className="feedback-error">{error}</p>}
            <div className="feedback-form-foot">
              <button className="home-tile-submit" disabled={busy} onClick={() => void submit()}>
                {busy ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
