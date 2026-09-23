import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useAuth } from './authProvider';
import { TOY_ACCOUNTS } from './accounts';
import { backendMode } from '../storage/backend';
import type { AuthCapabilities } from './types';
import { PageShell, hashLink } from '../components/PageShell';

/**
 * The sign-in screen, shown by <AuthGate> when a route that needs sign-in is
 * requested and nobody is signed in.
 *
 * Local mode: one button per toy account — no passwords; picking an account
 * logs in as that identity and its `role` drives which views are reachable.
 *
 * Remote mode: whatever the SERVER says it supports (`capabilities`, from
 * GET /api/auth/config), which is the whole point of the seam:
 *
 *   password — the launch system: sign in with your course email and the
 *              password you chose, create an account if you haven't yet (the
 *              roster decides who may), or ask to be added if your email
 *              isn't the one on file.
 *   sso      — one "Sign in with UCLA" button; no password field, no account
 *              creation (the identity provider owns both).
 *   dev      — email only, passwordless. Development and the closed pilot.
 *
 * Nothing here is rebuilt when that changes: switch the server's AuthProvider
 * and this screen follows.
 */
export function LoginScreen() {
  if (backendMode === 'remote') return <RemoteLoginScreen />;
  return <LocalLoginScreen />;
}

/**
 * The card variant of the page shell: the brand topbar and one centred card.
 * Every sign-in pane (the local picker; remote password / SSO / dev) OPENS
 * with the way past it: continue as a visitor, into the sandbox — first and
 * in the site's colours, because most people arriving from the website just
 * want to try the machines.
 */
function LoginCard({ children }: { children: ReactNode }) {
  return (
    <PageShell variant="card">
      <div className="mm-card mm-card--narrow">
        <div className="login-visitor">
          <p>Just exploring? Build circuits, state machines and Turing machines — no account needed.</p>
          <a className="mm-btn mm-btn--primary" {...hashLink({ kind: 'sandbox' })}>
            Continue as a visitor → Sandbox
          </a>
        </div>
        {children}
      </div>
    </PageShell>
  );
}

function LocalLoginScreen() {
  const { login } = useAuth();

  return (
    <LoginCard>
      <h1>Sign in</h1>
      <p className="mm-lede">Choose an account to continue.</p>
      <div className="login-accounts">
        {TOY_ACCOUNTS.map((account) => (
          <button
            key={account.id}
            className="login-account"
            onClick={() => void login(account.id)}
          >
            <span className="login-account-name">{account.name}</span>
            <span className={`login-account-role tag ${account.role === 'instructor' ? 'tag--exam' : 'tag--date'}`}>
              {account.role === 'instructor' ? 'Instructor' : 'Student'}
            </span>
            <span className="login-account-email">{account.email}</span>
          </button>
        ))}
      </div>
    </LoginCard>
  );
}

type Pane = 'signin' | 'create' | 'request';

function RemoteLoginScreen() {
  const { capabilities } = useAuth();
  const [pane, setPane] = useState<Pane>('signin');

  // The capabilities fetch is one request against a server HealthGate has
  // already confirmed is up, so this is a blink, not a wait.
  if (!capabilities) {
    return (
      <LoginCard>
        <h1>Sign in</h1>
        <p className="mm-lede">Loading…</p>
      </LoginCard>
    );
  }

  if (capabilities.mode === 'sso') return <SsoLoginScreen capabilities={capabilities} />;

  const tabs: { key: Pane; label: string }[] = [
    { key: 'signin', label: 'Sign in' },
    ...(capabilities.allowsRegistration ? [{ key: 'create' as const, label: 'Create account' }] : []),
    ...(capabilities.allowsAccessRequests ? [{ key: 'request' as const, label: 'Not on the roster?' }] : []),
  ];

  return (
    <LoginCard>
      {tabs.length > 1 ? (
        <div className="mm-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={pane === tab.key}
              className={`mm-tab${pane === tab.key ? ' mm-tab--active' : ''}`}
              data-text={tab.label}
              onClick={() => setPane(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : (
        <h1>Sign in</h1>
      )}
      {pane === 'signin' && <SignInPane capabilities={capabilities} />}
      {pane === 'create' && <CreateAccountPane capabilities={capabilities} onDone={() => setPane('signin')} />}
      {pane === 'request' && <RequestAccessPane onDone={() => setPane('signin')} />}
    </LoginCard>
  );
}

function SsoLoginScreen({ capabilities }: { capabilities: AuthCapabilities }) {
  return (
    <LoginCard>
      <h1>Sign in</h1>
      <p className="mm-lede">Use your UCLA account to continue.</p>
      <a className="mm-btn mm-btn--primary" href={capabilities.ssoLoginUrl ?? '#'}>
        Sign in with UCLA
      </a>
    </LoginCard>
  );
}

function SignInPane({ capabilities }: { capabilities: AuthCapabilities }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = email.trim() !== '' && (!capabilities.usesPassword || password !== '');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const result = await login(email.trim(), capabilities.usesPassword ? password : undefined);
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <>
      <p className="mm-lede">
        {capabilities.usesPassword
          ? 'Sign in with your course email and password.'
          : 'Sign in with your course email.'}
      </p>
      <form className="mm-form login-form" onSubmit={(e) => void handleSubmit(e)}>
        <input
          className="mm-input"
          type="email"
          autoFocus
          autoComplete="username"
          placeholder="you@ucla.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        {capabilities.usesPassword && (
          <input
            className="mm-input"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        )}
        <button className="mm-btn mm-btn--primary" type="submit" disabled={busy || !ready}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {error && <p className="mm-error">{error}</p>}
      {capabilities.usesPassword && (
        <p className="mm-note">
          Forgot your password? Ask your instructor to reset it — they can clear it so you can set
          a new one.
        </p>
      )}
    </>
  );
}

function CreateAccountPane({
  capabilities,
  onDone,
}: {
  capabilities: AuthCapabilities;
  onDone: () => void;
}) {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password !== '' && password.length < capabilities.passwordMinLength;
  const mismatch = confirm !== '' && confirm !== password;
  const ready = email.trim() !== '' && password !== '' && !tooShort && !mismatch && confirm !== '';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const result = await register({
      email: email.trim(),
      password,
      studentId: studentId.trim() || undefined,
    });
    setBusy(false);
    // On success the provider sets the user and this screen unmounts; the
    // onDone fallback only matters if that ever stops being true.
    if (!result.ok) setError(result.error);
    else onDone();
  };

  return (
    <>
      <p className="mm-lede">
        Use the email your instructor has on file, and choose a password. Your student ID confirms
        the account is yours.
      </p>
      <form className="mm-form login-form" onSubmit={(e) => void handleSubmit(e)}>
        <input
          className="mm-input"
          type="email"
          autoFocus
          autoComplete="username"
          placeholder="you@ucla.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <input
          className="mm-input"
          type="text"
          autoComplete="off"
          placeholder="Student ID"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          disabled={busy}
        />
        <input
          className="mm-input"
          type="password"
          autoComplete="new-password"
          placeholder={`Password (at least ${capabilities.passwordMinLength} characters)`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        <input
          className="mm-input"
          type="password"
          autoComplete="new-password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
        />
        <button className="mm-btn mm-btn--primary" type="submit" disabled={busy || !ready}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      {tooShort && (
        <p className="mm-error">
          Password must be at least {capabilities.passwordMinLength} characters.
        </p>
      )}
      {mismatch && <p className="mm-error">The two passwords don't match.</p>}
      {error && <p className="mm-error">{error}</p>}
    </>
  );
}

function RequestAccessPane({ onDone }: { onDone: () => void }) {
  const { requestAccess } = useAuth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const ready = email.trim() !== '' && name.trim() !== '';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const result = await requestAccess({
      email: email.trim(),
      name: name.trim(),
      studentId: studentId.trim() || undefined,
      message: message.trim() || undefined,
    });
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.error);
  };

  if (sent) {
    return (
      <>
        <p className="mm-lede">
          Request sent. Your instructor will review it — once they add you, come back and create
          your account with this email.
        </p>
        <button className="mm-btn mm-btn--primary" onClick={onDone}>
          Back to sign in
        </button>
      </>
    );
  }

  return (
    <>
      <p className="mm-lede">
        If the course roster has a different email for you (or doesn't have you yet), tell your
        instructor here.
      </p>
      <form className="mm-form login-form" onSubmit={(e) => void handleSubmit(e)}>
        <input
          className="mm-input"
          type="text"
          autoFocus
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <input
          className="mm-input"
          type="email"
          placeholder="The email you want to use"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <input
          className="mm-input"
          type="text"
          placeholder="Student ID"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          disabled={busy}
        />
        <textarea
          className="mm-input"
          placeholder="Anything your instructor should know (optional)"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={busy}
        />
        <button className="mm-btn mm-btn--primary" type="submit" disabled={busy || !ready}>
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </form>
      {error && <p className="mm-error">{error}</p>}
    </>
  );
}
