import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from './authProvider';
import { TOY_ACCOUNTS } from './accounts';
import { backendMode } from '../storage/backend';

/**
 * The login screen, shown by <AuthGate> whenever no user is set.
 *
 * Local mode: one button per toy account — no passwords; picking an account
 * logs in as that identity and its `role` drives which views are reachable.
 *
 * Remote mode: an email form. The server's dev auth logs in any roster email,
 * passwordless (the same trust level as the toy accounts, behind the class
 * roster); role comes back with the server session. UCLA SSO later replaces
 * the server-side provider — this form is what it swaps out.
 */
export function LoginScreen() {
  if (backendMode === 'remote') return <RemoteLoginScreen />;
  return <LocalLoginScreen />;
}

function LocalLoginScreen() {
  const { login } = useAuth();

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">Making Minds</h1>
        <p className="login-text">Sign in to continue. Choose an account:</p>
        <div className="login-accounts">
          {TOY_ACCOUNTS.map((account) => (
            <button
              key={account.id}
              className="login-account"
              onClick={() => void login(account.id)}
            >
              <span className="login-account-name">{account.name}</span>
              <span className={`login-account-role login-account-role--${account.role}`}>
                {account.role === 'instructor' ? 'Instructor' : 'Student'}
              </span>
              <span className="login-account-email">{account.email}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RemoteLoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const ok = await login(trimmed);
    setBusy(false);
    if (!ok) {
      setError('Sign-in failed — that email is not on the roster, or the server is unreachable.');
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">Making Minds</h1>
        <p className="login-text">Sign in with your course email:</p>
        <form className="login-form" onSubmit={(e) => void handleSubmit(e)}>
          <input
            className="login-email"
            type="email"
            autoFocus
            placeholder="you@ucla.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <button className="login-submit" type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  );
}
