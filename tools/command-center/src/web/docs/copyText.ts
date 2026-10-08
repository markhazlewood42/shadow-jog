// The text of the Copy button and the name of the Download button (revision 2, design 5.7). They are
// plain functions with no page in them, so a test can check the exact text that lands on the clipboard.

/** What the header of the copied text is made from, and the file text that follows it. */
export type CopyTextParts = {
  /** The title of the doc. It is line 1. */
  title: string;
  /** The path of the doc file in the repo, with forward slashes (`docs/engine/decisions.md`). */
  id: string;
  /** The GitHub repo as `owner/name`. The server sends it in /api/health. */
  githubRepo: string;
  /** The text of the doc file, as the source route sent it. It goes after the header without a change. */
  source: string;
};

/** The address of the file on GitHub. Each part of the path is encoded, so a file name with a space stays one link. */
function githubUrlOf(githubRepo: string, id: string): string {
  return `https://github.com/${githubRepo}/blob/main/${id.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * What the Copy button puts on the clipboard, for an LLM to read: a header of two lines (the title, then
 * the path of the file and its GitHub address), one blank line, and the file text as it is. The
 * frontmatter stays in the file text.
 */
export function buildCopyText({ title, id, githubRepo, source }: CopyTextParts): string {
  // A title is one line. White space in it is folded to single spaces, so the header is always exactly two lines.
  const line1 = title.replace(/\s+/g, ' ').trim();
  return `${line1}\n${id} ${githubUrlOf(githubRepo, id)}\n\n${source}`;
}

/** The name of the downloaded file: the file name of the doc (`decisions.md` for `docs/engine/decisions.md`). */
export function downloadName(id: string): string {
  return id.split('/').pop() ?? id;
}
