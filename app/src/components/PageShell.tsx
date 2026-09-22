import type { MouseEvent, ReactNode } from 'react';
import { navigate, routeToHash } from '../routing';
import type { Route } from '../routing';

/** The course website; the brand in every topbar leads back to it. */
export const SITE_URL = 'https://www.makingminds.org';

export interface ShellNavItem {
  label: string;
  route: Route;
  /** Rendered with the site's current-page underline. */
  current?: boolean;
}

export type NavRole = 'student' | 'instructor';

/**
 * The app's nav, derived from the role. A student has one page, Assignments.
 * An instructor moves between two views and the nav says so: Student view (the
 * catalog exactly as students see it) and Dashboard (the instructor area).
 * Sandbox is not a page — it opens the editor — so the shell sets it apart
 * as a boxed link beside the nav rather than listing it here.
 */
export function appNav(current: 'student' | 'dashboard', role: NavRole): ShellNavItem[] {
  if (role === 'instructor') {
    return [
      { label: 'Student view', route: { kind: 'home' }, current: current === 'student' },
      { label: 'Dashboard', route: { kind: 'instructor' }, current: current === 'dashboard' },
    ];
  }
  return [{ label: 'Assignments', route: { kind: 'home' }, current: current === 'student' }];
}

/** A real hash link (middle-click, copy) that still routes through `navigate`. */
export function hashLink(route: Route): { href: string; onClick: (e: MouseEvent<HTMLAnchorElement>) => void } {
  return {
    href: routeToHash(route),
    onClick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate(route);
    },
  };
}

/**
 * The page shell every surface OUTSIDE the circuit editor renders inside —
 * login and server-health screens, the home catalog, an assignment's question
 * list, the instructor views. It is the course website's own skeleton
 * (theme.css): a white topbar with the serif brand "Making Minds · Phil 133"
 * (a link to makingminds.org), the app's nav, the boxed Sandbox link, the
 * session controls on the right; the lavender band; ONE centred `.page`
 * column; the site footer. The shell is invariant: the same column and chrome
 * on every route and for every role, so crossing between the student catalog
 * and the instructor area moves nothing. A section's own navigation (the
 * instructor's tabs) belongs inside the column, not here.
 *
 * Presentation only: it knows nothing about auth or routing state, so
 * HealthGate can use it before any provider exists. Pages pass their nav
 * items and `<SessionControls />` (which does know the user) as props.
 *
 * `variant="card"` centres one `.mm-card` on the page field (login, health).
 */
export function PageShell({
  nav = [],
  session,
  variant = 'page',
  children,
}: {
  nav?: ShellNavItem[];
  session?: ReactNode;
  variant?: 'page' | 'card';
  children: ReactNode;
}) {
  return (
    <div className="mm-shell mm-surface">
      <header className="topbar">
        <div className="page">
          <a className="brand" href={SITE_URL} target="_blank" rel="noopener" title="The course website, makingminds.org">
            Making Minds<span className="course">Phil 133</span>
          </a>
          {nav.length > 0 && (
            <>
              <nav aria-label="App">
                {nav.map((item) => (
                  <a key={item.label} {...hashLink(item.route)} data-text={item.label} aria-current={item.current ? 'page' : undefined}>
                    {item.label}
                  </a>
                ))}
              </nav>
              <a
                className="navbox"
                {...hashLink({ kind: 'sandbox' })}
                title="The freeform workbook — opens the circuit editor"
              >
                Sandbox
              </a>
            </>
          )}
          {session}
        </div>
      </header>
      <div className="band" />
      <main className={variant === 'card' ? 'page mm-center' : 'page'}>{children}</main>
      <footer className="page">
        <span>Phil 133 · Making Minds · UCLA Department of Philosophy</span>
        <a href={SITE_URL} target="_blank" rel="noopener">makingminds.org</a>
      </footer>
    </div>
  );
}
