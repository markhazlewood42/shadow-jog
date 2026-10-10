/**
 * K-M Annex 7 (B2) and the loading dock where the job goes wrong.
 *
 * The map data is JSON now (M5 task 4): `annex.json`, `dock.json`. This file is the BEHAVIOR the JSON refers to by id
 * (predicates and scripts, moved as they were) and the join (`joinMap`, `mapdata.ts`). `tests/mapdata-all.test.ts` proves each joined map equals
 * the old TypeScript map (`tests/fixtures/maps/annex-old.ts`).
 */
import { annexDoor, annexGuards, annexLog, betrayal, cryopod, lattice, latticeEmitters, relay, wardenFight } from '../../story/chapter1';
import annexJson from './annex.json' with { type: 'json' };
import dockJson from './dock.json' with { type: 'json' };
import { joinMap, type MapBehavior } from './mapdata';

export const annexBehavior: MapBehavior = {
  when: {
    annex_key: (f) => !!f.annex_key,
    annex_panel: (f) => !!f.annex_panel,
    sable_joined: (f) => !!f.sable_joined,
    not_sable_joined: (f) => !f.sable_joined,
    not_annex_panel: (f) => !f.annex_panel,
    not_annex_key: (f) => !f.annex_key,
    not_lattice_off: (f) => !f.lattice_off,
    sable_joined_and_not_warden: (f) => !!f.sable_joined && !f.warden,
    warden: (f) => !!f.warden,
    lattice_lit_0: (f) => !f.lattice_off && !!latticeEmitters(f)[0],
    lattice_lit_1: (f) => !f.lattice_off && !!latticeEmitters(f)[1],
    lattice_lit_2: (f) => !f.lattice_off && !!latticeEmitters(f)[2],
    lattice_dark_0: (f) => !f.lattice_off && !latticeEmitters(f)[0],
    lattice_dark_1: (f) => !f.lattice_off && !latticeEmitters(f)[1],
    lattice_dark_2: (f) => !f.lattice_off && !latticeEmitters(f)[2],
  },
  scripts: {
    annex_guards: annexGuards,
    annex_door: annexDoor,
    log1_run: annexLog('PROJECT VESSEL · OVERVIEW', 'Woken subjects carry measurable spark reserves. Extraction yields a stable, transferable mana substrate. Applications: power, weapons, obedience.'),
    log2_run: async (s) => {
      await annexLog('SUBJECT LOG · S-3', 'Subject S-3 (human, hermetic) expired during extraction. Residual spirit bound to the WARDEN security core. Recommendation: repurpose all future expirees. Waste nothing.')(s);
      if (!s.flag('rook_log')) {
        s.set('rook_log');
        await s.say('rook', '…');
        await s.say('kit', 'Rook?');
        await s.say('rook', 'Seen a room like this before. Keep moving.');
      }
    },
    log3_run: async (s) => {
      await annexLog('MAIL · to: J. PALE', 'Your contractors should reach S-7 by the 14th. On recovery, please {c}close out the contractor account per standard protocol{/} and file the audit copy with Finance. — Operations')(s);
      if (!s.flag('read_mail')) {
        s.set('read_mail');
        await s.say('kit', '“Close out the account.” That’s us getting paid, right?');
        await s.say('hex', 'Probably. Finance. Audit copy. It’s the most boring email I’ve ever read.');
        await s.say('rook', '…Probably.');
      }
    },
    log4_run: annexLog('SUBJECT LOG · S-7', 'Subject S-7 (orc, shamanic, “crow” totem). Resistance to sedation: high. Yield: exceptional. On completion, transfer to Arcology Level 90; residue to a WARDEN-class core, as with S-3.'),
    cryopod: cryopod,
    lattice: lattice,
    relay_c_run: relay('c'),
    relay_b_run: relay('b'),
    relay_a_run: relay('a'),
    memo_run: annexLog('MEMO · LATTICE AUDIT', 'Relay A feeds emitters 1 and 2. Cycling a relay flips every emitter it feeds. The refit rewired B and C and nobody updated this memo, so watch the beams when you cycle them. Keep this taped to the desk, Dmitri.'),
    requisition_run: async (s) => {
      if (!s.flag('req_badge')) {
        s.set('req_badge');
        await s.narrate('A badge is still clipped into the reader: {c}D. PETROV, FACILITIES{/}.');
        await s.say('hex', 'Dmitri’s badge is still live. Dmitri, you beautiful, careless man.', { face: 'happy' });
        // The clue to the crawlspace: Dmitri never left.
        await s.narrate('{c}EVAC HEADCOUNT · 41 OF 42.{/} Missing: D. Petrov, Facilities. Last badge-in: west utility corridor, the night of the evacuation.');
        await s.say('rook', 'Stock up. Whatever’s behind that door, it isn’t a vending machine.');
      }
      await s.shop('km_requisition');
    },
    panel_run: async (s) => {
      if (!s.flag('req_badge')) {
        await s.narrate('A utility corridor wall panel, scuffed like everything down here.');
        return;
      }
      await s.narrate('The west utility corridor, where Dmitri last badged in. One wall panel sits a few millimetres proud of the rest. Scratches round the screws. Cold air on your fingers.');
      const pick = await s.ask(null, 'Pry the panel off?', ['Pry it off', 'Leave it'], { cancel: 1 });
      if (pick !== 0) return;
      s.sfx('door');
      s.set('annex_panel');
      s.refreshMap();
      await s.narrate('The panel comes away. Behind it, a crawlspace someone has been living in: a bedroll, ration wrappers, a K-M badge lanyard. {c}D. PETROV{/}. A duct runs north from it, toward the service corridor.');
      await s.say('hex', 'Dmitri. He didn’t leave with everyone else. He hid.', { face: 'sad' });
    },
    warden_fight: wardenFight,
    sealed_run: async (s) => s.narrate('A heavy blast door. The panel reads {r}CONTAINMENT · LOCKED{/}.'),
    to_dock_blocked: async (s) => s.narrate('The freight lift. The call panel is dead until the facility releases its security lock.'),
  },
};

export const annex = joinMap(annexJson, annexBehavior);

export const dockBehavior: MapBehavior = {
  when: {},
  scripts: {
    betrayal: betrayal,
    on_enter: async (s) => {
      if (s.flag('chapter_end')) return;
      await s.wait(30);
      await s.move('player', 'dd');
      await betrayal(s);
    },
  },
};

export const dock = joinMap(dockJson, dockBehavior);
