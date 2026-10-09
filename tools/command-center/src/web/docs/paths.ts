// The addresses of the docs pages. A doc is named by its slug (`engine/decisions`): the page is
// `/docs/engine/decisions` and its data is `/api/docs/engine/decisions`. Both the page and the
// server read the slug from the part after `docs/`, and the slug has slashes in it, so each piece
// between the slashes is percent-encoded and the slashes stay.

/** The address of a doc's page, with the id of one of its headings as the hash when there is one. */
export function docPath(slug: string, heading?: string): string {
  const path = `/docs/${slug.split('/').map(encodeURIComponent).join('/')}`;
  return heading === undefined || heading === '' ? path : `${path}#${encodeURIComponent(heading)}`;
}

/** The address that answers with the doc's data (a Panel). */
export function docApiPath(slug: string): string {
  return `/api${docPath(slug)}`;
}

/** The address that answers with the text of the doc file, as it is (the Copy and Download buttons ask for it). */
export function docSourcePath(slug: string): string {
  return `${docApiPath(slug)}/source`;
}

/**
 * Decodes `%C3%BC` to `ü`. Text that is not valid percent-encoding (`100%`) stays as it was written.
 * It is the one decoder of the docs pages: a heading id, a hash and a slug all come out of an address.
 */
export function decodeOrKeep(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The slug of the doc that an address shows, or null when the address is the overview (`/docs`) or
 * not a docs address at all. This reads the address itself and does not trust the router's own
 * decoding of the part after `/docs/`, so the slug is the same text in every case.
 */
export function slugFromPath(pathname: string): string | null {
  const match = /^\/docs(?:\/(.*))?$/.exec(pathname);
  if (match === null) return null;
  const rest = (match[1] ?? '').replace(/\/+$/, '');
  return rest === '' ? null : rest.split('/').map(decodeOrKeep).join('/');
}
