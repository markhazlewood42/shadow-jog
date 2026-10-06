/**
 * The first line of what a program printed that has text on it, ready to put into a message that a
 * person reads: control characters (a color code, a bell) become spaces, and a long line is cut.
 * Empty when the program printed nothing. Used for the error messages about git and gh.
 */
export function firstLine(text: string, maxChars = 200): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim() !== '') ?? '';
  const clean = line.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim();
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}...` : clean;
}
