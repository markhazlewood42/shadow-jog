import { Link } from 'react-router';
import { useDocumentTitle } from '../docs/useDocumentTitle';

/** The page at /workstreams in the local build. The local server has no data for it until step 6 of design.md section 11.3, so the page says that, with a link back. */
export function LocalWorkstreams() {
  useDocumentTitle('Workstreams');
  return (
    <div className="min-h-screen">
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Workstreams</h1>
        <p className="text-cc-muted">The hosted page has this view. The local server gets it later.</p>
        <p>
          <Link to="/" className="text-cc-link underline underline-offset-2 cc-focus-ring">
            Now
          </Link>
        </p>
      </main>
    </div>
  );
}
