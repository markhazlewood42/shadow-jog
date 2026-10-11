/**
 * The DEV menu (dev server only): a small "DEV" tab in the top-left corner of the game page that
 * opens a list of every dev tool (src/dev/tools.ts), so none of their addresses need remembering.
 * The ` key (left of 1) toggles it too, and `/?devmenu` opens the page with it open (the tool pages
 * link back that way). It isn't mounted under Playwright (`navigator.webdriver`), so tests and
 * screenshot scripts never see it, and it isn't in the shipped game (boot.ts loads it only in DEV).
 */
import { mapIds } from '../data/maps';
import { STAGES } from '../game/stages';
import { VERSION_LABEL } from '../version';
import { DEV_TOOLS, type DevTool } from './tools';

const CSS = `
#devmenu-tab { position: fixed; top: 6px; left: 6px; z-index: 50; padding: 3px 8px; border: 1px solid #3a3550; border-radius: 4px;
  background: #15131fcc; color: #ffcc3d; font: 600 11px/1.3 ui-monospace, Consolas, monospace; letter-spacing: 0.12em; cursor: pointer; opacity: 0.6; }
#devmenu-tab:hover, #devmenu-tab[aria-expanded='true'] { opacity: 1; }
#devmenu { position: fixed; top: 0; left: 0; bottom: 0; z-index: 49; width: min(380px, 100vw); overflow-y: auto; padding: 38px 14px 16px;
  background: #100e18f2; border-right: 1px solid #2e2a3d; color: #e9e6f2; font: 13px/1.4 system-ui, 'Segoe UI', sans-serif; user-select: text; }
#devmenu[hidden] { display: none; }
#devmenu .build { margin: 0; color: #9b96ad; font: 12px/1.3 ui-monospace, Consolas, monospace; }
#devmenu h2 { margin: 14px 0 6px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #9b96ad; }
#devmenu a { display: block; padding: 6px 8px; border-radius: 6px; color: inherit; text-decoration: none; border: 1px solid transparent; }
#devmenu a:hover { background: #1f1c2a; border-color: #3a3550; }
#devmenu a.here { border-color: #ffcc3d66; }
#devmenu a b { display: block; font-weight: 600; }
#devmenu a span { color: #9b96ad; font-size: 12px; }
#devmenu .pick { display: flex; gap: 6px; align-items: center; margin: -2px 0 4px 8px; color: #9b96ad; font-size: 12px; }
#devmenu select { background: #1f1c2a; color: inherit; border: 1px solid #3a3550; border-radius: 4px; font: inherit; padding: 1px 4px; }
#devmenu footer { margin-top: 16px; color: #6f6a82; font-size: 12px; }
`;

/** The choices for a tool that takes one (a map, a story stage). */
const CHOICES: Record<NonNullable<DevTool['pick']>, () => string[]> = {
  map: () => mapIds(),
  stage: () => Object.keys(STAGES),
};

export function mountDevMenu(open = false): void {
  if (navigator.webdriver || document.getElementById('devmenu')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const tab = document.createElement('button');
  tab.id = 'devmenu-tab';
  tab.textContent = 'DEV';
  tab.title = 'Dev tools (` key)';
  const panel = document.createElement('nav');
  panel.id = 'devmenu';
  panel.setAttribute('aria-label', 'Dev tools');
  const here = location.pathname + location.search;

  const build = document.createElement('p');
  build.className = 'build';
  build.textContent = `Shadow Jog ${VERSION_LABEL}`;
  panel.append(build);

  for (const { group, tools } of DEV_TOOLS) {
    const h = document.createElement('h2');
    h.textContent = group;
    panel.append(h);
    for (const t of tools) {
      const a = document.createElement('a');
      a.href = t.path;
      if (here === t.path || (here.startsWith(t.path) && t.pick)) a.className = 'here';
      const name = document.createElement('b');
      name.textContent = t.name;
      const about = document.createElement('span');
      about.textContent = t.about;
      a.append(name, about);
      panel.append(a);
      if (t.pick) {
        // A picker beside it: the link goes to the chosen one.
        const param = t.pick;
        const sel = document.createElement('select');
        const now = new URLSearchParams(location.search).get(param);
        for (const c of CHOICES[param]()) {
          const o = document.createElement('option');
          o.value = c;
          o.textContent = c;
          o.selected = c === now;
          sel.append(o);
        }
        const go = () => {
          a.href = `${t.path}&${param}=${encodeURIComponent(sel.value)}`;
        };
        sel.addEventListener('change', go);
        go();
        const row = document.createElement('label');
        row.className = 'pick';
        row.append(`${param === 'map' ? 'Map' : 'Stage'}:`, sel);
        panel.append(row);
      }
    }
  }
  const foot = document.createElement('footer');
  foot.textContent = 'All of these, and the console hooks, are in docs/DEVELOPING.md §4. The list itself is src/dev/tools.ts.';
  panel.append(foot);

  const show = (on: boolean) => {
    panel.hidden = !on;
    tab.setAttribute('aria-expanded', String(on));
    tab.textContent = on ? 'DEV ✕' : 'DEV';
    // Back to the game's canvas, so its keys work again.
    if (!on) {
      const canvas = document.querySelector<HTMLCanvasElement>('#stage canvas');
      if (canvas) {
        if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = -1; // the new engine's canvas has no tabindex; -1 lets code focus it
        canvas.focus();
      }
    }
  };
  tab.addEventListener('click', () => show(Boolean(panel.hidden)));
  // ` toggles; Esc closes it (only while open, before the game sees the key).
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code === 'Backquote' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        show(Boolean(panel.hidden));
      } else if (e.code === 'Escape' && !panel.hidden) {
        e.stopImmediatePropagation();
        show(false);
      }
    },
    true,
  );
  document.body.append(panel, tab);
  show(open);
}
