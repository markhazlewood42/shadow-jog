import type { NavSection } from '../../shared/types';

// Which data layer the page uses (design.md section 4.3). The choice is made once, when the page is BUILT: the Vercel build sets
// `VITE_HOSTED=1` (see vercel.json), and the local build (`npm run cc`) does not. Vite puts the value into the code as a constant, so the
// local page has no dead hosted code to run, and the hosted page has no way to try `/api/events` that the Vercel project does not have.
//
// Why a build flag and not a probe at run time: a probe ("does /api/health answer?") needs a request before the first paint, and it cannot
// tell a local server that is down from a host that never had one. A page that guessed wrong would poll the wrong endpoints and look broken.
// The two builds go to two places (the local server serves `dist/`, Vercel serves its own build), so the flag cannot be wrong for the place.

/** True in the build for Vercel. A function and not a constant, so a test can set the flag with `vi.stubEnv('VITE_HOSTED', '1')`. */
export function isHosted(): boolean {
  return import.meta.env.VITE_HOSTED === '1';
}

/** The repo that the hosted page reads, as `owner/name`. A test checks that it is the repo of the GitHub API adapter. */
export const HOSTED_REPO = 'markhazlewood42/shadow-jog';

/** The address of the Workstreams view. nav.json lists it as a page of the site. */
export const WORKSTREAMS_PATH = '/workstreams';

/**
 * The docs navigation as this build shows it. The Workstreams page exists only in the hosted build (the local server gets it in step 6 of design.md section 11.3),
 * so the local build takes its entry out of the list. nav.json is one file for both builds.
 */
export function visibleNav(nav: readonly NavSection[], hosted: boolean = isHosted()): NavSection[] {
  if (hosted) return [...nav];
  return nav.map((section) => ({ ...section, items: section.items.filter((item) => !(item.kind === 'page' && item.path === WORKSTREAMS_PATH)) }));
}
