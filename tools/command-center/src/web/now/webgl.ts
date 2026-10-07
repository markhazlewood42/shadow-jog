// The one question that the glass needs answered before it starts: can this browser draw WebGL2? The glass panels (PlasmaUI) draw on a WebGL2
// canvas. When the answer is no, the Now page shows plain panels and says why, and never starts the glass.

/**
 * Whether the browser gives a WebGL2 context. It asks a small canvas that is never put in the page. `doc` is the document to make the canvas with
 * (a test gives a made-up one); without it the page's own document is used, and where there is none (Node) the answer is no.
 *
 * It does not throw: a browser whose GPU process has crashed can throw from `getContext`, and that also means no.
 */
export function supportsWebGL2(doc?: Pick<Document, 'createElement'>): boolean {
  const target = doc ?? (typeof document === 'undefined' ? null : document);
  if (target === null) return false;

  let context: WebGL2RenderingContext | null;
  try {
    context = target.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
  if (context === null) return false;

  // The context was only for the question. A browser keeps a limited number of them alive (about 16 for a page), and the glass needs one of its
  // own, so this one is given back at once. Failing to give it back changes nothing about the answer: the browser did make a WebGL2 context.
  try {
    context.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // see above
  }
  return true;
}
