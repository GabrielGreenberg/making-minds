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

/**
 * The app's nav, the same on every page: Assignments · Sandbox · Instructor
 * (the last only for instructor accounts — students never see it; typing the
 * hash still hits the access-denied gate).
 */
export function appNav(current: 'assignments' | 'instructor', instructor: boolean): ShellNavItem[] {
  return [
    { label: 'Assignments', route: { kind: 'home' }, current: current === 'assignments' },
    { label: 'Sandbox', route: { kind: 'sandbox' } },
    ...(instructor
      ? [{ label: 'Instructor', route: { kind: 'instructor' as const }, current: current === 'instructor' }]
      : []),
  ];
}

/** A real hash link (middle-click, copy) that still routes through `navigate`. */
function onNavClick(route: Route) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(route);
  };
}

/**
 * The page shell every surface OUTSIDE the circuit editor renders inside —
 * login and server-health screens, the home catalog, an assignment's question
 * list, the instructor views. It is the course website's own skeleton
 * (theme.css): a white topbar with the serif brand "Making Minds · Phil 133"
 * (a link to makingminds.org), the app's nav, the session controls on the
 * right; the lavender band; a centred `.page` column; the site footer.
 *
 * Presentation only: it knows nothing about auth or routing state, so
 * HealthGate can use it before any provider exists. Pages pass their nav
 * items and `<SessionControls />` (which does know the user) as props.
 *
 * `variant="card"` centres one `.mm-card` on the page field (login, health);
 * `width="wide"` widens the column for the instructor's tables.
 */
function NavLinks({ items }: { items: ShellNavItem[] }) {
  return (
    <>
      {items.map((item) => (
        <a
          key={item.label}
          href={routeToHash(item.route)}
          onClick={onNavClick(item.route)}
          aria-current={item.current ? 'page' : undefined}
        >
          {item.label}
        </a>
      ))}
    </>
  );
}

export function PageShell({
  nav = [],
  subnav = [],
  session,
  variant = 'page',
  width = 'default',
  children,
}: {
  nav?: ShellNavItem[];
  /** A section's own navigation (the instructor's Dashboard · Roster · Feedback · Notes):
   *  a second bar under the topbar, same link idiom. */
  subnav?: ShellNavItem[];
  session?: ReactNode;
  variant?: 'page' | 'card';
  width?: 'default' | 'wide';
  children: ReactNode;
}) {
  const pageClass = width === 'wide' ? 'page page--wide' : 'page';
  return (
    <div className="mm-shell mm-surface">
      <header className="topbar">
        <div className={pageClass}>
          <a className="brand" href={SITE_URL} target="_blank" rel="noopener" title="The course website, makingminds.org">
            Making Minds<span className="course">Phil 133</span>
          </a>
          {nav.length > 0 && (
            <nav aria-label="App">
              <NavLinks items={nav} />
            </nav>
          )}
          {session}
        </div>
      </header>
      {subnav.length > 0 && (
        <div className="subbar">
          <nav className={pageClass} aria-label="Section">
            <NavLinks items={subnav} />
          </nav>
        </div>
      )}
      <div className="band" />
      <main className={variant === 'card' ? `${pageClass} mm-center` : pageClass}>{children}</main>
      <footer className="page">
        <span>Phil 133 · Making Minds · UCLA Department of Philosophy</span>
        <a href={SITE_URL} target="_blank" rel="noopener">makingminds.org</a>
      </footer>
    </div>
  );
}
