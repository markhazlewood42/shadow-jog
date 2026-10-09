/**
 * The effects section of the DEV tab, on the new engine only (docs/engine/m2-brief.md task 8, playable checkpoint 1).
 *
 * `src/dev/devmenu.ts` builds the DEV tab and its list of tools. When the game runs on the new engine (`?engine=sje`), the DEV hook calls
 * `mountFxPanel`, which adds a section to that list: a level picker (`auto`, `full`, `lite`, `none`), one button for every moment in
 * `fx.json` that `playMoment` can fire (it fires at the screen center), and a line of live counts. So a person can look at each hit on demand.
 *
 * The tab is built by a dynamic import that may finish after the engine's hook, so this waits for `#devmenu` to exist. The tab is never mounted
 * under Playwright (`navigator.webdriver`), and `devhook.ts` does not call this there. A shipped build never loads this file.
 */
import type { FxCounts, FxRequest } from '../sje';

/** The part of the DEV hook the panel uses. */
export interface FxPanelHook {
  fxCounts(): FxCounts;
  setFxLevel(level: FxRequest): void;
  fxMoments(): string[];
  playMoment(name: string, x?: number, y?: number): boolean;
}

const CSS = `
#devmenu-fx .row { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px; }
#devmenu-fx button { background: #1f1c2a; color: inherit; border: 1px solid #3a3550; border-radius: 4px; padding: 3px 7px; font: 12px/1.3 ui-monospace, Consolas, monospace; cursor: pointer; }
#devmenu-fx button:hover { border-color: #ffcc3d99; }
#devmenu-fx .counts { color: #9b96ad; font: 12px/1.3 ui-monospace, Consolas, monospace; }
`;

const LEVELS: FxRequest[] = ['auto', 'full', 'lite', 'none'];

export function mountFxPanel(hook: FxPanelHook): void {
  let tries = 0;
  const attempt = () => {
    const panel = document.getElementById('devmenu');
    if (!panel) {
      // The tab loads a moment after the game: look again for a few seconds, then give up (a page without the tab).
      if (++tries < 120) requestAnimationFrame(attempt);
      return;
    }
    if (document.getElementById('devmenu-fx')) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);

    const section = document.createElement('section');
    section.id = 'devmenu-fx';
    const h = document.createElement('h2');
    h.textContent = 'Effects (new engine)';
    section.append(h);

    const levelRow = document.createElement('label');
    levelRow.className = 'pick';
    const select = document.createElement('select');
    for (const l of LEVELS) {
      const o = document.createElement('option');
      o.value = l;
      o.textContent = l;
      select.append(o);
    }
    select.value = new URLSearchParams(location.search).get('fx') ?? 'auto';
    select.addEventListener('change', () => hook.setFxLevel(select.value as FxRequest));
    levelRow.append('Level:', select);
    section.append(levelRow);

    const row = document.createElement('div');
    row.className = 'row';
    const counts = document.createElement('p');
    counts.className = 'counts';
    for (const name of hook.fxMoments()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.title = `Play the moment "${name}" at the screen center`;
      b.addEventListener('click', () => {
        if (!hook.playMoment(name)) counts.textContent = `"${name}" did not play: the level is ${hook.fxCounts().level}, so no effect is live.`;
      });
      row.append(b);
    }
    section.append(row, counts);
    // Counts, twice a second while the tab is open.
    window.setInterval(() => {
      if (panel.hidden) return;
      const c = hook.fxCounts();
      counts.textContent = `level ${c.level}${c.active ? '' : ' (off)'} | shocks ${c.shocks} hazes ${c.hazes} glitches ${c.glitches} particles ${c.particles}`;
    }, 500);
    const foot = panel.querySelector('footer');
    panel.insertBefore(section, foot);
  };
  attempt();
}
