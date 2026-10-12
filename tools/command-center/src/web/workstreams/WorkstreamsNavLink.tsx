import { Link } from 'react-router';
import { WORKSTREAMS_PATH, isHosted } from '../hosted/mode';

/** The "Workstreams" link of the main navigation. It shows only in the hosted build: the local server has no data for the page yet (design.md section 11.3, step 6). */
export function WorkstreamsNavLink({ current = false }: { current?: boolean }) {
  if (!isHosted()) return null;
  return (
    <Link to={WORKSTREAMS_PATH} {...(current ? { 'aria-current': 'page' as const } : {})} className={`${current ? 'text-cc-ink' : 'text-cc-muted hover:text-cc-ink'} cc-focus-ring`}>
      Workstreams
    </Link>
  );
}
