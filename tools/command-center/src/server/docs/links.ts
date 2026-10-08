import { posix } from 'node:path';
import { say } from '../messages';

// A link in a doc is text the author typed: a path to another doc, an anchor, a web address, or
// something hostile. `resolveHref` decides what it points at. It is a pure function (it reads no
// file): the doc index tells it what exists, so a test can give it a made-up repo.

/** What a link points at, once it is checked against the repo. */
export type ResolvedLink =
  /** Another doc of the site. The page address is `docUrl(slug, anchor)`. */
  | { kind: 'doc'; slug: string; anchor?: string }
  /** A file the site serves itself, like a diagram picture or the HTML source of a diagram. */
  | { kind: 'asset'; url: string }
  /** A file of the repo that is not a doc and not served: it opens on GitHub. */
  | { kind: 'github'; url: string }
  /** A web address outside the repo. */
  | { kind: 'external'; url: string }
  /** A jump inside the same doc (`#some-heading`). */
  | { kind: 'anchor' }
  /** A link that goes nowhere, or that the site refuses to follow. The reason is for a person to read. */
  | { kind: 'broken'; reason: string };

/** What the repo holds, as far as links are concerned. Every path is relative to the repo root, with forward slashes. */
export type KnownTargets = {
  /** The path of each doc, and its slug (the doc's address on the site is `/docs/<slug>`). */
  docs: Map<string, string>;
  /** The path of each file the site serves (pictures, diagram sources), and the url that serves it. */
  assets: Map<string, string>;
  /**
   * Whether a file or folder is in the repo. It is asked only about a clean path: not empty, not
   * the repo root, no `..`, no leading or trailing slash, no backslash and no control character.
   * It should match case, as GitHub does, or a link with the wrong case would look fine here and
   * be a 404 there.
   */
  exists(path: string): boolean;
};

/** The first letters of an address up to its colon: `https:`, `javascript:`, `C:`. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** What no file name in the repo can hold. A backslash is here because GitHub reads it as a plain character, not as a folder break. */
const NOT_IN_A_FILE_NAME = /[\u0000-\u001f\u007f\\]/;

/**
 * Says what a link points at.
 *
 * @param href the link as the doc wrote it (after markdown's own tidy-up of the address)
 * @param fromDocId the path of the doc that holds the link, such as `docs/engine/README.md`: a
 *   relative link is relative to its folder
 * @param known what the repo holds
 * @param githubBlobBase where a repo file can be read on GitHub, such as
 *   `https://github.com/<owner>/<repo>/blob/<branch>`
 */
export function resolveHref(href: string, fromDocId: string, known: KnownTargets, githubBlobBase: string): ResolvedLink {
  // A browser drops tabs and line breaks anywhere in an address, and spaces and control characters
  // around it, before it reads the address. Do the same, so `java<tab>script:` is seen for what it is.
  const link = href.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');

  if (link === '') return broken(say('linkReasonEmpty'));
  if (link.startsWith('#')) return { kind: 'anchor' };
  // A link that starts with // means "the same scheme as this page". A doc has no page of its own
  // to borrow a scheme from, and the address it means is one on the open web, so read it as https.
  if (link.startsWith('//')) return webAddress(`https:${link}`);

  const scheme = SCHEME.exec(link)?.[1]?.toLowerCase();
  if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return webAddress(link);
  // Every other scheme is refused: `javascript:` and `data:` would run code on this page, `file:`
  // cannot be opened from a web page, and the rest have no use in a doc. (A Windows path such as
  // `C:\notes` also looks like a scheme, and is no use in a doc either.)
  if (scheme !== undefined) return broken(say('linkReasonScheme', { scheme }));

  return repoLink(link, fromDocId, known, githubBlobBase);
}

/** The address of a doc on this site. The anchor is optional: pass the heading id as plain text, and it is percent-encoded here. */
export function docUrl(slug: string, anchor?: string): string {
  const path = slug.split('/').map(encodeURIComponent).join('/');
  return anchor === undefined || anchor === '' ? `/docs/${path}` : `/docs/${path}#${encodeURIComponent(anchor)}`;
}

function broken(reason: string): ResolvedLink {
  return { kind: 'broken', reason };
}

/** A web or mail address. Parsing it with `URL` is what the browser would do, and gives one clean spelling. */
function webAddress(address: string): ResolvedLink {
  try {
    return { kind: 'external', url: new URL(address).href };
  } catch {
    return broken(say('linkReasonNotWeb'));
  }
}

/** A link with no scheme: a path in the repo, relative to the doc that holds it. */
function repoLink(link: string, fromDocId: string, known: KnownTargets, githubBlobBase: string): ResolvedLink {
  const hashAt = link.indexOf('#');
  const beforeHash = hashAt === -1 ? link : link.slice(0, hashAt);
  const anchor = hashAt === -1 ? '' : decodeOrKeep(link.slice(hashAt + 1));
  // GitHub links often end in `?plain=1`. The query says nothing about which file it is.
  const rawPath = beforeHash.split('?')[0] ?? '';
  if (rawPath === '') return broken(say('linkReasonNoPath'));

  let path: string;
  try {
    // The address is percent-encoded (a space is %20), a file name is not. Decode first and only
    // then look for `..`, or `%2e%2e` would climb out of the repo unseen.
    path = decodeURIComponent(rawPath);
  } catch {
    return broken(say('linkReasonEscape'));
  }
  if (NOT_IN_A_FILE_NAME.test(path)) return broken(say('linkReasonBadChars'));

  // A leading / means the repo root, as on GitHub. Anything else starts from the doc's own folder.
  // `normalize` and `join` fold away `.` and `..`, and keep a leading `..` that climbs out.
  const joined = path.startsWith('/') ? posix.normalize(path.replace(/^\/+/, '')) : posix.join(posix.dirname(fromDocId), path);
  if (joined === '..' || joined.startsWith('../')) return broken(say('linkReasonOutside'));
  const repoPath = joined.replace(/\/+$/, ''); // a link to a folder may end in a slash
  // The repo root has no page on this site, and no blob address on GitHub: nothing to link to.
  if (repoPath === '.') return broken(say('linkReasonRoot'));

  const slug = known.docs.get(repoPath);
  if (slug !== undefined) return anchor === '' ? { kind: 'doc', slug } : { kind: 'doc', slug, anchor };

  const assetUrl = known.assets.get(repoPath);
  if (assetUrl !== undefined) return { kind: 'asset', url: withAnchor(assetUrl, anchor) };

  if (!known.exists(repoPath)) return broken(say('linkReasonNoFile'));
  const blob = `${githubBlobBase.replace(/\/+$/, '')}/${repoPath.split('/').map(encodeURIComponent).join('/')}`;
  return { kind: 'github', url: withAnchor(blob, anchor) };
}

/** Decodes `%C3%A9` to `é`. An anchor that is not valid percent-encoding (`100%`) stays as it was written. The decisions module reads the anchors of an issue with it too. */
export function decodeOrKeep(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function withAnchor(url: string, anchor: string): string {
  return anchor === '' ? url : `${url}#${encodeURIComponent(anchor)}`;
}
