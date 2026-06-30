import { useAuth } from './stubAuth';
import { TOY_ACCOUNTS } from './accounts';

/**
 * Mockup login screen. Renders one button per toy account — no passwords. Picking
 * an account logs in as that identity; its `role` then drives which views are
 * reachable (see InstructorGate). Shown by <AuthGate> whenever no user is set.
 */
export function LoginScreen() {
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
              onClick={() => login(account.id)}
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
