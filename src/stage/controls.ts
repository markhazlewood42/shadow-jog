/**
 * The lab page's three pickers (spike `spike/phaser-stage`): which stage (street or sewer), how many enemies
 * (1 to 6, or a boss with 0, 1 or 2 helpers), and which moment of the turn (choosing, aiming, acting). They are
 * plain HTML selects over the corner of the page that call the scene's own methods, so the page needs no
 * framework, and the same three choices can be given in the address (`?stage=sewer&set=boss&phase=act`).
 *
 * They are lab furniture, not the editor: the Battle Stage Editor (the next step) replaces them with its own
 * panels. Press H to hide or show them (a screenshot of the stage should be only the stage).
 */
import { SET_KEYS, type StageFile } from './config';
import type { Phase } from './demo';
import type { StageScene } from './stagescene';

const PHASES: Array<{ id: Phase; label: string }> = [
  { id: 'choose', label: 'Choosing (menu open)' },
  { id: 'target', label: 'Aiming (pick a target)' },
  { id: 'act', label: 'Acting (a hit lands)' },
];

const SET_LABELS: Record<string, string> = { boss: 'Boss alone', 'boss+1': 'Boss + 1', 'boss+2': 'Boss + 2' };

/** One labelled select. */
function pick(label: string, id: string, options: Array<{ value: string; label: string }>, value: string, onChange: (v: string) => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const sel = document.createElement('select');
  sel.id = id;
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.append(opt);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.append(sel);
  return wrap;
}

/** Fill the bar element with the pickers and wire them to the scene. A change that fails is reported with `onError` (the page shows it in red) instead of vanishing into the console. */
export function mountControls(bar: HTMLElement, scene: StageScene, stages: StageFile, onError: (message: string) => void): void {
  bar.replaceChildren();
  const safely = (change: () => void): void => {
    try {
      change();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const stageOptions = Object.entries(stages).map(([id, s]) => ({ value: id, label: s.name }));
  bar.append(
    pick('Stage', 'pick-stage', stageOptions, scene.config.id, (id) => safely(() => scene.showStage(id))),
    pick(
      'Enemies',
      'pick-set',
      SET_KEYS.map((k) => ({ value: k, label: SET_LABELS[k] ?? k })),
      scene.enemySet,
      (k) => safely(() => scene.setEnemySet(k)),
    ),
    pick(
      'Turn',
      'pick-phase',
      PHASES.map((p) => ({ value: p.id, label: p.label })),
      scene.currentPhase,
      (p) => safely(() => scene.setPhase(p as Phase)),
    ),
  );
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target instanceof HTMLSelectElement)) bar.hidden = !bar.hidden;
  });
}
