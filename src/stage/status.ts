/** The little status line at the bottom of `/stagelab.html` (one place for it, so every entry page shows messages the same way). */
export interface Status {
  /** Show a message; `bad` paints it as an error. An empty message hides the line. */
  show: (message: string, bad?: boolean) => void;
}

export function statusLine(id = 'status'): Status {
  const el = document.getElementById(id);
  return {
    show(message, bad = false) {
      if (!el) return;
      el.textContent = message;
      el.className = bad ? 'bad' : '';
      el.style.display = message ? 'block' : 'none';
    },
  };
}
