import { useState } from 'react';
import { navigate } from '../routing';

// Dismissal lasts for the browser session: a returning visitor is reminded
// once per visit, never nagged within one. Per-viewer convenience only.
const DISMISS_KEY = 'mm:visitor-banner-dismissed';

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) != null;
  } catch {
    return false;
  }
}

/**
 * The one-line strip under the sandbox's menu bar for a visitor: what they're
 * using, and the way in for a PHIL 133 student. Dismissible.
 */
export function VisitorBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // storage unavailable — dismissed until the next reload
    }
    setDismissed(true);
  };

  return (
    <div className="visitor-banner" role="note">
      <span>
        You're in the sandbox as a visitor — build anything; it stays in this browser.
        PHIL 133 student?{' '}
        <button type="button" className="visitor-banner-link" onClick={() => navigate({ kind: 'home' })}>
          Sign in
        </button>
      </span>
      <button type="button" className="visitor-banner-close" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
