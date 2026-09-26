import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from './authProvider';

/**
 * "Password" button + its modal, shown beside the session controls wherever
 * the chrome offers them (the page shell's topbar, the editor menu bar).
 * Renders NOTHING unless the server's sign-in system actually manages
 * passwords — under SSO or dev login there is nothing here to change, and the
 * button would be a dead end.
 *
 * Changing the password ends every other session (the server's rule), so a
 * student who signed in on a shared lab machine can lock it out from home.
 */
export function AccountPanel() {
  const { user, capabilities } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user || !capabilities?.usesPassword) return null;

  return (
    <>
      <button type="button" className="menu-link-button" onClick={() => setOpen(true)}>
        Password
      </button>
      {open && <ChangePasswordModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { capabilities, changePassword } = useAuth();
  const minLength = capabilities?.passwordMinLength ?? 8;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const tooShort = next !== '' && next.length < minLength;
  const mismatch = confirm !== '' && confirm !== next;
  const ready = current !== '' && next !== '' && confirm !== '' && !tooShort && !mismatch;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const result = await changePassword(current, next);
    setBusy(false);
    if (result.ok) setDone(true);
    else setError(result.error);
  };

  return (
    <div className="mm-modal-backdrop" onClick={onClose}>
      <div className="mm-modal mm-modal--narrow mm-surface" onClick={(e) => e.stopPropagation()}>
        <div className="mm-modal-head">
          <h2>Change password</h2>
        </div>
        {done ? (
          <>
            <p className="mm-lede">
              Password changed. You are still signed in here; any other device has been signed out.
            </p>
            <div className="mm-actions">
              <button className="mm-btn mm-btn--primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <form className="mm-form" onSubmit={(e) => void handleSubmit(e)}>
              <input
                className="mm-input"
                type="password"
                autoFocus
                autoComplete="current-password"
                placeholder="Current password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={busy}
              />
              <input
                className="mm-input"
                type="password"
                autoComplete="new-password"
                placeholder={`New password (at least ${minLength} characters)`}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                disabled={busy}
              />
              <input
                className="mm-input"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
              />
              {tooShort && (
                <p className="mm-error">Password must be at least {minLength} characters.</p>
              )}
              {mismatch && <p className="mm-error">The two passwords don't match.</p>}
              {error && <p className="mm-error">{error}</p>}
              <div className="mm-actions">
                <button type="button" className="mm-btn" onClick={onClose}>
                  Cancel
                </button>
                <button className="mm-btn mm-btn--primary" type="submit" disabled={busy || !ready}>
                  {busy ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
