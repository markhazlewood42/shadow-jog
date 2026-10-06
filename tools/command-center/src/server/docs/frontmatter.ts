import { type YAMLError, parseDocument } from 'yaml';

// Many docs open with a "frontmatter" block: lines of `key: value` between two `---` lines, which
// say what kind of doc it is, its status and its dates. This file cuts that block off and reads it.

/** What `splitFrontmatter` hands back. */
export type SplitFrontmatter = {
  /** The key: value pairs of the block. Empty when there is no block, or when it could not be read. */
  data: Record<string, unknown>;
  /** The doc without its block. Every line break is LF, and a byte order mark at the start is gone. */
  body: string;
  /** What is wrong with the block, as one line for a person to read. Null when it is fine or absent. */
  error: string | null;
};

/** A line that opens or closes the block: three dashes, and nothing but spaces after them. */
const FENCE = /^---[ \t]*$/;

/**
 * Splits a doc into its frontmatter and its body. It never throws: a block that cannot be read
 * comes back as `error`, with empty `data`, and the doc is still there in `body`, so the page can
 * show the doc and say what is wrong with its header.
 *
 * The block must start on the first line of the file. A `---` line anywhere else is a thematic
 * break (a horizontal rule) of the body, not a fence.
 */
export function splitFrontmatter(src: string): SplitFrontmatter {
  // Text saved by any editor reads the same once every line break is LF. A byte order mark, which
  // some Windows editors put at the start of a file, would hide the first fence, so it goes too.
  const text = src.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  const firstLineEnd = text.indexOf('\n');
  if (firstLineEnd === -1 || !FENCE.test(text.slice(0, firstLineEnd))) {
    return { data: {}, body: text, error: null };
  }

  // Look for the closing fence line by line. (A pattern over the whole text could be slow on a
  // long doc, and this walk is plainly linear.)
  const blockStart = firstLineEnd + 1;
  let lineStart = blockStart;
  while (lineStart <= text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    if (FENCE.test(text.slice(lineStart, lineEnd))) {
      const { data, error } = readYaml(text.slice(blockStart, lineStart));
      return { data, body: newline === -1 ? '' : text.slice(newline + 1), error };
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }

  // No closing fence. The text may be a doc that opens with a horizontal rule, or a header that
  // lost its last line. Either way the safe thing is to keep all of it as the body and say so.
  return { data: {}, body: text, error: 'The frontmatter is never closed: it needs a line with only --- after it.' };
}

/** Reads the text between the fences as YAML. */
function readYaml(block: string): { data: Record<string, unknown>; error: string | null } {
  try {
    // The default settings are the safe ones for text we did not write: YAML 1.2, no tags that run
    // code (an unknown tag is only a warning, and its value stays plain text), a repeated key is an
    // error, and a limit on aliases stops a "billion laughs" file from eating the memory. Only the
    // logging is changed: by default the library prints a warning to the console for an odd but
    // harmless header (a list used as a key), and a doc must not make noise in the server's output.
    const document = parseDocument(block, { logLevel: 'silent' });
    const problem = document.errors[0];
    if (problem) return { data: {}, error: `Invalid YAML in the frontmatter: ${describe(problem)}` };

    // The alias limit is checked here, not while parsing, so this call is the one that can throw.
    const value: unknown = document.toJS();
    if (value === null) return { data: {}, error: null }; // an empty block, or one of only comments
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { data: {}, error: 'The frontmatter must be key: value lines, not a list or a single value.' };
    }
    // A YAML mapping becomes a plain object. (Dates stay text in YAML 1.2, which suits a header.)
    return { data: value as Record<string, unknown>, error: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { data: {}, error: `Invalid YAML in the frontmatter: ${message.split('\n')[0] ?? message}` };
  }
}

/** The reason a YAML error gives, with the line counted in the file. */
function describe(problem: YAMLError): string {
  // The message is "<reason> at line 2, column 8:" and then a picture of the line. Keep the reason.
  const reason = (problem.message.split('\n')[0] ?? '').replace(/ at line \d+, column \d+:?$/, '');
  const line = problem.linePos?.[0].line;
  // YAML counts from the first line after the opening fence, so the file's line is one more.
  return line === undefined ? reason : `${reason} (line ${line + 1})`;
}
