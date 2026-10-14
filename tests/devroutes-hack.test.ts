/** `?scene=hack&id=<unknown>` (third review of PR #80, finding 4): the throw of `hackDef` must not leave the `&frame=` override on for later hacks. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDevScene } from '../src/devroutes';
import type { Game } from '../src/sje';
import { hackDevOverride, setHackDevOverride } from '../src/game/hackseam';

// The route file imports every dev scene, and some of them need a DOM at import time. This case runs the hack route only, so the scenes are empty stand-ins.
vi.mock('../src/scenes/battle', () => ({ BattleScene: class {} }));
vi.mock('../src/dev/viewers/bestiarytest', () => ({ BestiaryTestScene: class {} }));
vi.mock('../src/dev/viewers/chartest', () => ({ CharTestScene: class {} }));
vi.mock('../src/scenes/field', () => ({ FieldScene: class {} }));
vi.mock('../src/dev/viewers/fonttest', () => ({ FontTestScene: class {} }));
vi.mock('../src/dev/viewers/mapview', () => ({ MapViewScene: class {} }));
vi.mock('../src/scenes/panels', () => ({ PanelScene: class {} }));
vi.mock('../src/dev/viewers/portraittest', () => ({ PortraitTestScene: class {} }));

describe('the ?scene=hack route', () => {
  afterEach(() => setHackDevOverride(null));

  it('an unknown id throws, and the frame override from &frame= is not left set', () => {
    setHackDevOverride(null);
    const params = new URLSearchParams('id=no-such-hack&frame=canvas-copy');
    expect(() => runDevScene({} as Game, 'hack', params)).toThrow(/no hack "no-such-hack"/);
    expect(hackDevOverride()).toBeNull();
  });
});
