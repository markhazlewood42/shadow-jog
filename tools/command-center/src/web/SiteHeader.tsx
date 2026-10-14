import { Link, useLocation } from 'react-router';
import { APP_NAME } from '../shared/types';
import { WORKSTREAMS_PATH } from './hosted/mode';
import { WorkstreamsNavLink } from './workstreams/WorkstreamsNavLink';

// The one header of the site. App.tsx draws it once, above every page, so no page builds a header of its own: the title, the links and their place on the screen are the
// same on every page (Mark, 2026-10-14: "The nav jumps between pages"). A page names itself with a heading in its body. The Docs search box lives in the body of the Docs page.
// The header does not change height or width from page to page. The links stay at the right edge, and the right edge is the same on every page because the page keeps room
// for its scroll bar at all times (`scrollbar-gutter` in theme.css).

const isRoadmap = (path: string) => path === '/docs/roadmap' || path.startsWith('/docs/roadmap/');
const isDocs = (path: string) => path === '/docs' || path.startsWith('/docs/');

/** Whether an address belongs to a page other than the Now page. App.tsx shows the Now page for every address it does not know, so such an address marks "Now". */
const isKnownPath = (path: string) => path === '/agents' || path === WORKSTREAMS_PATH || isDocs(path) || path.startsWith('/decisions/');

/** The pages that the header links to, in the order they show. `isCurrent` says whether an address is that page. The decision page is none of them. */
const PAGES: readonly { to: string; label: string; isCurrent: (path: string) => boolean }[] = [
  { to: '/', label: 'Now', isCurrent: (path) => path === '/' || !isKnownPath(path) },
  { to: '/docs/roadmap/README', label: 'Roadmap', isCurrent: isRoadmap },
  { to: '/docs', label: 'Docs', isCurrent: (path) => isDocs(path) && !isRoadmap(path) },
  { to: '/agents', label: 'Agents', isCurrent: (path) => path === '/agents' },
];

export function SiteHeader() {
  const { pathname } = useLocation();
  // A trailing slash names the same page.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return (
    <header className="sticky top-0 z-30 border-b border-cc-rule-solid bg-cc-paper">
      {/* On a phone the links may wrap under the title. `ml-auto` keeps them at the right edge, beside the title or on a row of their own. */}
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 sm:px-6">
        <Link to="/" className="font-semibold tracking-tight cc-focus-ring">
          {APP_NAME}
        </Link>
        <nav aria-label="Main" className="ml-auto flex items-center gap-4 text-sm">
          {PAGES.map((page) => {
            const current = page.isCurrent(path);
            return (
              <Link key={page.to} to={page.to} {...(current ? { 'aria-current': 'page' as const } : {})} className={`${current ? 'text-cc-ink' : 'text-cc-muted hover:text-cc-ink'} cc-focus-ring`}>
                {page.label}
              </Link>
            );
          })}
          <WorkstreamsNavLink current={path === WORKSTREAMS_PATH} />
        </nav>
      </div>
    </header>
  );
}
