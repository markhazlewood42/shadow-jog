// What the art pass generates: every asset, its current art, and the recipes for its options.
// pass.mjs runs these; the review page (?scene=artreview) shows them side by side for Mark to pick.
//
// House recipe (settled with Mark on 2026-09-30, from the Kit tests): PixelLab Pro Flash, Low
// Top-Down, a style image, and a prompt that spells out the look ("chibi, about 2.5 heads tall...
// at most 15 colors, bold black outline"). Naming Phantasy Star IV in the prompt made results
// noisier, so prompts describe the look instead. Scale is the game's: 640x360 (480x270 before 2026-10-09), 16 px tiles,
// field characters ~28 px tall. All battle art is generated at the field's pixel density (the
// battle world's "res 2"), so the whole game shares one pixel size.
import { readFileSync } from 'node:fs';

const CUR = 'current';
const STYLE_KIT = 'media/art-pass/style/kitb-south.png';
const enemiesMeta = JSON.parse(readFileSync('media/art-pass/current/enemies.json', 'utf8'));

/** Round up to PixelLab's custom-size step (4). */
const step4 = (n) => Math.ceil(n / 4) * 4;

const FIELD_TAIL = 'chibi proportions about 2.5 heads tall, big head, short legs, flat colors with one shadow tone, at most 15 colors, bold black outline';
const field = (who) => `16-bit JRPG overworld sprite: ${who}, ${FIELD_TAIL}`;
const WALK = { name: 'walk', label: 'Walk', template: 'walking-4-frames', directions: ['south', 'east', 'north', 'west'] };
const FIELD_DIRS = ['south', 'east', 'north', 'west', 'south-east', 'south-west', 'north-east', 'north-west'];

// ------------------------------------------------------------------ the crew in the field

const CREW = {
  kit: '19-year-old street brawler girl, warm brown skin, very dark plum-black hair in a high ponytail, red-orange cropped jacket with gold trim, black top, dark navy pants, dark brown boots, taped hand wraps',
  rook: '41-year-old street samurai man, light tan skin, short grey hair, short grey beard, amber-tinted sunglasses, olive-green long coat over a dark shirt, chrome cybernetic right arm, katana on his back with the hilt over his right shoulder, dark grey pants, black boots',
  hex: '34-year-old dwarf woman hacker, short and stocky, pale peach skin, teal hair in a messy bun, dark goggles with cyan lenses pushed up on her forehead, big purple jacket with a yellow belt, dark top, dark purple-grey pants, dark boots, a cyberdeck strapped to her back with a thin whip antenna rising above her head',
  sable: '24-year-old orc shaman, tall and broad, grey-green skin, two small tusks, long straight off-white hair, narrow gold eyes, deep red tunic over a dark brown shirt, brown pants, dark boots, holding a wooden staff taller than they are with black crow feathers tied under its head',
};

function crew() {
  const out = [];
  for (const [who, desc] of Object.entries(CREW)) {
    const base = {
      id: `crew.${who}`,
      category: 'Crew · field',
      title: who[0].toUpperCase() + who.slice(1),
      kind: 'field',
      current: [{ file: `${CUR}/char/${who}.png`, label: 'Now (4 facings)', scale: 1, strip: 4 }],
    };
    if (who === 'kit' || who === 'rook') {
      const ids = { kit: '2137bb8f-5859-46b1-a3f3-d7b386cef9f2', rook: '8109d0ef-7b1b-4f2d-9d59-ec0d0622a06b' };
      out.push({
        ...base,
        note: who === 'kit' ? 'Your pick from the tests (hand wraps, not despeckled), now with a walk cycle.' : 'The Rook from the tests, now with a walk cycle.',
        options: [
          { id: 'chosen', kind: 'character', characterId: ids[who], label: 'From the tests', recipe: 'Pro Flash 32 px · style: his/her current sprite', anims: [WALK] },
          // Round 2 (Mark's review, 2026-09-30): the test Kit has no face in her side views.
          ...(who === 'kit'
            ? [1, 2].map((n) => ({ id: `redo${n}`, kind: 'character', size: { width: 32, height: 32 }, prompt: field(`${desc}, her face clearly drawn in the side views (eye, nose and mouth in profile)`), style: STYLE_KIT, seed: n * 37, cost: 6, label: `Round 2, try ${n}`, recipe: 'Pro Flash 32 px · style: the test Kit · face in profile asked for', anims: [WALK] }))
            : []),
        ],
      });
      continue;
    }
    out.push({
      ...base,
      note: 'Two style anchors: their own current sprite (keeps their colours), or the new Kit (matches the crew).',
      options: [
        { id: 'own', kind: 'character', size: { width: 32, height: 32 }, prompt: field(desc), style: `media/art-pass/current/char/${who}.style32.png`, cost: 6, label: 'Styled on their current sprite', recipe: 'Pro Flash 32 px · style: current sprite', anims: [WALK] },
        { id: 'kit', kind: 'character', size: { width: 32, height: 32 }, prompt: field(desc), style: STYLE_KIT, cost: 6, label: 'Styled on the new Kit', recipe: 'Pro Flash 32 px · style: new Kit', anims: [WALK] },
      ],
    });
  }
  return out;
}

// ------------------------------------------------------------------ the crew in battle (backs)

const BATTLE_TAIL = 'adult proportions about 5 heads tall, 16-bit JRPG battle sprite, flat colors with two shadow tones, bold black outline';
const N = ['north'];
const IDLE = { name: 'idle', label: 'Idle (fight stance)', template: 'fight-stance-idle-8-frames', directions: N };
const HURT = { name: 'hurt', label: 'Hurt', template: 'taking-punch', directions: N };
const ITEM = { name: 'item', label: 'Item (throw)', template: 'throw-object', directions: N };
const WIN = { name: 'victory', label: 'Victory', template: 'two-footed-jump', directions: N };
const CAST = { name: 'cast', label: 'Cast', template: 'fireball', directions: N };
/** Custom (v3) actions cost ceil(128² x frames / 65536) per direction: 2 at 8 frames. */
const v3 = (name, label, action) => ({ name, label, action, frames: 8, directions: N, cost: 2 });
const BATTLE_ANIMS = {
  kit: [IDLE, { name: 'attack', label: 'Attack (cross punch)', template: 'cross-punch', directions: N }, { name: 'special', label: 'Special (hurricane kick)', template: 'hurricane-kick', directions: N }, HURT, ITEM, WIN],
  rook: [IDLE, v3('attack', 'Attack (katana slash)', 'slashes the katana in a wide horizontal arc'), v3('thrust', 'Thrust', 'lunges forward and thrusts the katana straight ahead'), HURT, ITEM],
  hex: [IDLE, { name: 'attack', label: 'Attack (jab)', template: 'lead-jab', directions: N }, CAST, HURT, ITEM, WIN],
  sable: [IDLE, v3('attack', 'Attack (staff strike)', 'swings the long staff overhead and strikes down'), CAST, HURT, ITEM],
};

function battle() {
  return Object.entries(CREW).map(([who, desc]) => ({
    id: `battle.${who}`,
    category: 'Crew · battle',
    title: `${who[0].toUpperCase() + who.slice(1)} (battle, from behind)`,
    kind: 'battler',
    note: 'Seen from behind, as in battle. At the field’s pixel size, so twice as fine as today’s battle sprites. Idle, attack, hurt and more are animated; the game will pick frames for its poses.',
    current: ['idle', 'attack', 'strike', 'cast', 'hurt', 'victory'].map((p) => ({ file: `${CUR}/battler/${who}-${p}.png`, label: `Now: ${p}`, scale: 2 })),
    options: [
      { id: 'house', kind: 'character', size: { width: 128, height: 128 }, prompt: `${desc}, ${BATTLE_TAIL}`, style: STYLE_KIT, styleOptions: { color_palette: true, outline: true, detail: false, shading: true }, cost: 8, label: 'Styled on the new Kit', recipe: 'Pro Flash 128 px · style: new Kit (palette, outline, shading)', showDir: 'north', anims: BATTLE_ANIMS[who] },
      { id: 'plain', kind: 'character', size: { width: 128, height: 128 }, prompt: `${desc}, ${BATTLE_TAIL}`, cost: 8, label: 'Prompt only', recipe: 'Pro Flash 128 px · no style image', showDir: 'north', anims: BATTLE_ANIMS[who] },
    ],
  }));
}

// ------------------------------------------------------------------ enemies and bosses

const ENEMY = {
  rustfang_medic: 'Rustfang Patcher, a young gang street medic, spiky red hair, cyan goggles, white vest with a red cross patch over a black shirt, a satchel of medical supplies, holding a glowing red injector',
  rustfang_punk: 'Rustfang Punk, a gang bruiser with a tall red mohawk, bare muscular arms, black leather vest with shoulder spikes, a red fang gang patch, gripping a spiked baseball bat',
  rustfang_slinger: 'Rustfang Slinger, a hooded gang member in a green hoodie with a glowing cyan face mask, holding up a lit molotov cocktail',
  glowrat: 'Glowrat, a big mutant sewer rat, mauve-grey fur, pink ears and tail, glowing red eyes, faint violet magical glow',
  scrap_hound: 'Scrap Hound, a lean robotic guard dog made of battered grey steel armour plates, exposed hydraulic joints, rust patches, one glowing red eye, standing on four legs, side three-quarter view',
  street_drone: 'Street Drone, an old police hover drone, rounded dark blue-grey body, four small rotors, red and blue police light bar on top, single red camera eye',
  smog_wisp: 'Smog Wisp, a ghost made of grey-violet exhaust smoke, hollow dark eyes, a swirling wispy body trailing into tendrils',
  knuckles: '"Knuckles" Tran, a burly gang enforcer boss, red mohawk, black tank top, gold chain, two huge chrome cybernetic fists raised to fight',
  sewer_ghoul: 'Sewer Ghoul, a gaunt infected man, grey-green skin, glowing yellow eyes, tattered dark coat, hunched, long clawed hands',
  rust_crab: 'Rust Crab, a giant armoured crab, rust-orange shell riveted with metal plates, two big claws raised, eye stalks',
  maint_drone: 'Maintenance Drone, a boxy yellow tunnel-maintenance robot on caterpillar treads, black hazard stripes, one camera eye on top, a jointed robot arm ending in a clamp',
  drowned_shade: 'Drowned Shade, the translucent teal ghost of a drowned commuter, bowler hat, long melting face with hollow eyes, dripping tentacle-like lower body, holding a briefcase',
  gutter_eel: 'Gutter Eel, a huge green electric eel, glowing cyan spots along its body, mouth full of needle teeth, coiled mid-lunge',
  lurker: 'The Lurker, a giant mutant anglerfish sea serpent rising out of dark water, dark teal scales, enormous jaw full of white fangs, a glowing cyan lure on a stalk over its head, pale belly plates, two thick tentacles curling up on either side, spiny fins',
  km_sentinel: 'K-M Sentinel, a corporate security officer in a dark navy tactical uniform and helmet with a cyan visor, holding a black rifle',
  sentry_turret: 'Sentry Turret, a ceiling-mounted twin-barrel autogun, grey armoured dome with a yellow stripe, red targeting eye, hazard-striped mount',
  km_arcanist: 'K-M Arcanist, a corporate mage woman, short pale hair, a pink-magenta visor over her eyes, dark purple corporate suit, holding up a glowing violet orb of magic',
  hunter_drone: 'Hunter Drone, a sleek black corporate attack drone shaped like a missile, red sensor eye, cyan thruster glow, red-striped fins',
  bound_spirit: 'Bound Spirit, a violet ghost trapped in glowing cyan binding bands, arms raised, screaming hollow mouth',
  warden: 'WARDEN, a hulking white and grey corporate security mech, boxy armoured chest with a round violet glass core holding a screaming face, a shoulder cannon, big round shoulder pads, short heavy legs',
  warden_spirit: 'Unbound Warden, a huge furious violet spirit breaking free, arms raised, hollow screaming face, shattered cyan binding shards and white armour fragments flying around it',
};
const ENEMY_TAIL = 'front three-quarter view facing the viewer, 16-bit JRPG battle enemy sprite, detailed pixel art, two shadow tones, bold black outline';

function enemies() {
  return Object.entries(ENEMY).map(([key, desc]) => {
    const m = enemiesMeta[key];
    // Art pixels today, and the size at the field's pixel density (res 2).
    const art = { w: Math.round(m.w * m.res), h: Math.round(m.h * m.res) };
    const size = { width: Math.min(256, step4(m.w * 2)), height: Math.min(256, step4(m.h * 2)) };
    const cost = size.width * size.height > 160 * 160 ? 9 : size.width * size.height > 64 * 64 ? 6 : 5;
    return {
      id: `enemy.${key}`,
      category: m.boss ? 'Bosses' : 'Enemies',
      title: m.name,
      kind: 'enemy',
      note: `${m.family}. Today ${art.w}x${art.h} art at ${m.res === 1 ? 'half' : 'full'} pixel density; new art is ${size.width}x${size.height} at full density.${key === 'scrap_hound' ? ' (Your note: the hounds look janky.)' : ''}`,
      current: [{ file: `${CUR}/enemy/${key}.png`, label: 'Now', scale: 2 / m.res }],
      options: [
        { id: 'faithful', kind: 'image', size, prompt: `${desc}, ${ENEMY_TAIL}`, style: `media/art-pass/current/enemy/${key}.png`, styleOptions: { color_palette: true, outline: true, detail: false, shading: false }, cost, label: 'Redraw of today’s design', recipe: 'Pro Flash image · style: current sprite (palette + outline)' },
        { id: 'house', kind: 'image', size, prompt: `${desc}, ${ENEMY_TAIL}`, style: STYLE_KIT, styleOptions: { color_palette: false, outline: true, detail: false, shading: true }, cost, label: 'New look, crew style', recipe: 'Pro Flash image · style: new Kit (outline + shading)' },
      ],
    };
  });
}

// ------------------------------------------------------------------ portraits

const PORTRAIT = {
  kit: '19-year-old woman, warm brown skin, dark plum-black hair in a high ponytail with a magenta streak, confident smirk, red-orange jacket, small cyan earring',
  rook: '41-year-old man, light tan skin, short grey hair, short grey beard, dark sunglasses, olive-green coat, a chrome cybernetic arm at his shoulder, stern',
  hex: '34-year-old dwarf woman, pale peach skin, teal hair in a bun, goggles with violet lenses pushed up on her forehead, big purple jacket, sardonic grin',
  sable: '24-year-old orc, grey-green skin, two small tusks, long straight off-white hair, narrow gold eyes, pale face markings, deep red tunic, calm and distant',
  dutch: 'big bearded man in his fifties, dark brown skin, bald, thick black beard, plum-purple coat, gold chain, warm smile',
  pale: 'Mr. Pale, a pale thin man, slicked-back white hair, a glowing red visor across his eyes, white suit, red tie, expressionless',
  mags: 'Old Mags, an old woman, tanned skin, grey bob haircut, goggles with green lenses on her forehead, brown work jacket, frowning, squinting',
  yun: 'Doc Yun, a street doctor, light skin, black bob haircut with bangs, black-rimmed glasses, white medical coat over a teal shirt',
};
const PORTRAIT_TAIL = 'bust portrait, head and shoulders, facing the viewer, 16-bit JRPG dialogue portrait, clean pixel art, two shadow tones, dark outline';

function portraits() {
  return Object.entries(PORTRAIT).map(([key, desc]) => ({
    id: `portrait.${key}`,
    category: 'Portraits',
    title: key[0].toUpperCase() + key.slice(1),
    kind: 'portrait',
    note: 'Dialogue portrait, 48x48. New ones have no background; the review shows them on today’s striped card.',
    current: [{ file: `${CUR}/portrait/${key}.png`, label: 'Now', scale: 1 }],
    options: [
      { id: 'faithful', kind: 'image', size: { width: 48, height: 48 }, prompt: `${desc}, ${PORTRAIT_TAIL}`, style: `media/art-pass/current/portrait/${key}.png`, cost: 5, label: 'Styled on today’s portrait', recipe: 'Pro Flash image 48 px · style: current portrait' },
      { id: 'fresh', kind: 'image', size: { width: 48, height: 48 }, prompt: `${desc}, ${PORTRAIT_TAIL}`, cost: 5, label: 'Prompt only', recipe: 'Pro Flash image 48 px · no style image' },
      // Round 2 (Mark's review): his notes on the ones he liked.
      ...(PORTRAIT_FIX[key]
        ? [1, 2].map((n) => ({ id: `fix${n}`, kind: 'image', size: { width: 48, height: 48 }, prompt: `${PORTRAIT_FIX[key]}, ${PORTRAIT_TAIL}`, style: `media/art-pass/current/portrait/${key}.png`, seed: n * 41, cost: 5, label: `Round 2, try ${n}`, recipe: 'Pro Flash image 48 px · style: current portrait · your notes' }))
        : []),
    ],
  }));
}

/** Round 2 portraits: Mark's notes folded into the description. */
const PORTRAIT_FIX = {
  pale: 'Mr. Pale, a pale thin man, slicked-back white hair, a glowing red visor across his eyes drawn in detail (a bright scan line, a reflective glint, a dark frame), white suit, red tie, expressionless',
  rook: '41-year-old man with broad powerful shoulders, light tan skin, short grey hair, short grey beard, dark sunglasses, olive-green coat, his chrome cybernetic right arm clearly visible from the shoulder down, stern',
};

// ------------------------------------------------------------------ townsfolk and named NPCs

const npcPlaces = JSON.parse(readFileSync('media/art-pass/current/npcs.json', 'utf8'));
/** Where an NPC stands (for "try in game"): the first placement using this look or id. */
const placeOf = (pred) => {
  const n = npcPlaces.find(pred);
  return n ? { map: n.map, at: n.x != null ? { x: n.x, y: n.y } : undefined } : {};
};

/** Named looks (src/data/looks.ts): story characters who also walk in cutscenes, so they get a walk. */
const NAMED = {
  mags: ['Old Mags (and Hedda)', 'old woman scav boss, tanned skin, grey bob haircut, goggles with green lenses on her forehead, brown work jacket, dark grey pants, leaning on a cane'],
  pale: ['Mr. Pale', 'thin pale man, slicked-back white hair, glowing red visor over his eyes, white suit, red tie, white trousers, black shoes'],
  pale_rain: ['Mr. Pale (rain)', 'thin pale man, slicked-back white hair, glowing red visor over his eyes, white suit, red tie, holding a red umbrella over his head'],
  dutch: ['Dutch', 'big heavyset fixer, dark brown skin, thick black beard, wide-brimmed plum hat with a gold band, long plum-purple coat over a gold shirt, dark pants'],
  ganger: ['Rustfang ganger', 'gang punk, tall red mohawk, tan skin, bare arms, black vest with a red fang patch, dark purple-grey pants, black boots'],
  corpsec: ['K-M security (visor)', 'corporate security officer, navy blue uniform, navy peaked cap, glowing cyan visor, black boots'],
  corpsec2: ['K-M security (shades)', 'corporate security officer, dark brown skin, short black hair, dark sunglasses, navy blue uniform, frowning, black boots'],
  corpsec3: ['K-M security (sergeant)', 'big corporate security sergeant, light skin, brown hair, navy peaked cap, navy blue uniform with gold rank stripes, black boots'],
};

/** One-off NPCs whose looks are inline on their maps (keyed map.id). */
const UNIQUE = {
  'lantern_row.skewer': ['Skewer Vendor', 'street food vendor, messy red hair, navy work jacket, white apron, holding a meat skewer'],
  'lantern_row.fetish': ['Charm Seller', 'old orc woman, grey-green skin, long white hair, purple shawl hung with small charms and beads'],
  'world.km_gate': ['K-M Checkpoint', 'corporate checkpoint officer, navy uniform, navy peaked cap, cyan visor, holding a glowing tablet'],
  'world.hermit': ['Old Marrow', 'old hermit, long white hair and beard, ragged dark green coat, gnarled walking stick'],
  'world.fisher': ['Canal Fisher', 'canal fisherman, brown skin, olive bucket hat, grey jacket, holding a fishing rod'],
  'world.dj': ['Static Mary', 'pirate radio DJ woman, bright pink hair, big headphones around her neck, navy bomber jacket'],
  'rustyard.knuckles': ['“Knuckles” Tran', 'burly gang enforcer, red mohawk, black tank top, gold chain, two huge chrome cybernetic fists'],
  'rustyard.guard_b': ['Rustfang guard', 'gang member, shaggy brown hair, navy jacket with a red fang patch, dark pants'],
  'rustyard.nephew': ['Tobin', 'teenage boy, dark brown skin, shaved head, grey hoodie with paint-splattered sleeves'],
  'sinkline_1.wire': ['Wire', 'scrawny black-market dealer, spiky violet hair, black jacket with pink trim, one glowing cyan cybernetic eye'],
  'bar.barkeep': ['Saint', 'bartender, pale skin, slicked two-tone black and white hair, brown vest over a white shirt, bow tie'],
  'bar.old_runner': ['Old Runner', 'grizzled retired street runner, dark skin, spiky bright green hair, navy jacket, a chrome cybernetic ear'],
  'clinic.yun': ['Doc Yun', 'street doctor, black bob haircut with bangs, black-rimmed glasses, white medical coat over a teal shirt'],
  'armory.tomas': ['Brother Tomas', 'burly bald priest and armourer, brown skin, brown monk robe with a rope belt, leather smith apron'],
  'threads.wen': ['Auntie Wen', 'elderly tailor, grey hair in a bun, round glasses, lavender cardigan, a measuring tape around her neck'],
  'kwikmart.clerk': ['Kwik-Mart Clerk', 'convenience store clerk, young woman, long dark purple hair, red store vest over a navy shirt, name tag'],
  'hotel.hotelclerk': ['Desk Clerk', 'hotel desk clerk, bright cyan hair, dark navy uniform jacket with brass buttons'],
  'noodles.ono': ['Mama Ono', 'elderly noodle-shop owner, white hair in a bun, red apron over a white shirt, holding a ladle'],
};

/** Generic townsfolk: a pool of looks the game maps its random passers-by onto. */
const POOL = [
  ['Commuter', 'young woman in a yellow raincoat with the hood down, dark bob haircut, carrying a shoulder bag'],
  ['Worker', 'middle-aged dock worker, brown skin, grey beanie, orange hi-vis vest over a grey work jacket'],
  ['Salaryman', 'tired office worker, rumpled grey suit, loosened red tie, briefcase'],
  ['Punk girl', 'young punk woman, pink undercut hair, studded black leather jacket, ripped jeans'],
  ['Grandmother', 'old woman, white hair, flower-print shawl, carrying a shopping bag of groceries'],
  ['Teen', 'teenager in an oversized neon green hoodie, headphones, sneakers'],
  ['Scav', 'scavenger in a patched brown hooded poncho, goggles, respirator mask, backpack of scrap'],
  ['Street kid', 'small street kid, messy hair, oversized faded red t-shirt, shorts, sneakers'],
];

function npcs() {
  const named = Object.entries(NAMED).map(([key, [title, desc]]) => ({
    id: `npc.${key}`,
    category: 'Named NPCs',
    title,
    kind: 'npc',
    look: key,
    ...placeOf((n) => n.named === key),
    note: 'A story character, styled on the new Kit, with a walk for cutscenes.',
    current: [{ file: `${CUR}/char/${key}.png`, label: 'Now (4 facings)', scale: 1 }],
    options: [{ id: 'house', kind: 'character', size: { width: 32, height: 32 }, prompt: field(desc), style: STYLE_KIT, cost: 6, label: 'Styled on the new Kit', recipe: 'Pro Flash 32 px · style: new Kit', anims: [WALK] }],
  }));
  const unique = Object.entries(UNIQUE).map(([key, [title, desc]]) => ({
    id: `npc.${key.replace('.', '-')}`,
    category: 'Named NPCs',
    title,
    kind: 'npc',
    npc: key,
    ...placeOf((n) => `${n.map}.${n.id}` === key),
    note: 'Stands in one place, so no walk cycle yet.',
    current: [{ file: `${CUR}/char/${key}.png`, label: 'Now (4 facings)', scale: 1 }],
    options: [{ id: 'house', kind: 'character', size: { width: 32, height: 32 }, prompt: field(desc), style: STYLE_KIT, cost: 6, label: 'Styled on the new Kit', recipe: 'Pro Flash 32 px · style: new Kit' }],
  }));
  const pool = POOL.map(([title, desc], i) => ({
    id: `town.${String(i + 1).padStart(2, '0')}`,
    category: 'Townsfolk',
    title,
    kind: 'npc',
    pool: i,
    map: 'lantern_row',
    note: 'One of the passer-by looks. The game’s random townsfolk would each be mapped onto one of these.',
    current: [1, 2, 3].map((k) => ({ file: `${CUR}/char/lantern_row.p${((i + k) % 8) + 1}.png`, label: `Now: a passer-by`, scale: 1 })).slice(0, 1),
    options: [{ id: 'house', kind: 'character', size: { width: 32, height: 32 }, prompt: field(desc), style: STYLE_KIT, cost: 6, label: 'Styled on the new Kit', recipe: 'Pro Flash 32 px · style: new Kit', anims: [WALK] }],
  }));
  const cat = {
    id: 'critter.noodle',
    category: 'Named NPCs',
    title: 'Noodle (the cat)',
    kind: 'critter',
    map: 'noodles',
    note: 'Mama Ono’s lost orange cat, one ear. Today she’s drawn by the critter code; this is a sprite for her.',
    current: [],
    options: [{ id: 'house', kind: 'character', template: 'cat', size: { width: 32, height: 32 }, prompt: '16-bit JRPG overworld sprite: a small scruffy orange tabby cat with only one ear, flat colors with one shadow tone, bold black outline', style: STYLE_KIT, styleOptions: { color_palette: false, outline: true, detail: true, shading: true }, cost: 6, label: 'Styled on the new Kit', recipe: 'Pro Flash 32 px · cat template' }],
  };
  return [...named, ...unique, cat, ...pool];
}

// ------------------------------------------------------------------ terrain (Wang tilesets)

/** [id, title, lower, upper, transition, place photographed for "now"] */
const TERRAIN = [
  ['street', 'Street and sidewalk', 'dark blue-grey wet asphalt road with faint cracks', 'grey concrete sidewalk slabs', 'concrete curb edge', 'street'],
  ['canal', 'Canal and embankment', 'dark murky teal canal water', 'grey concrete canal embankment walkway', 'worn stone edge', 'canal'],
  ['sewer', 'Sinkline water and floor', 'dark green flooded sewer water', 'grimy grey concrete sewer floor with algae stains', 'broken concrete lip', 'sewer'],
  ['yard', 'Rustyard dirt and scrap', 'packed brown dirt ground', 'heaps of rusty scrap metal and rubble', '', 'yard'],
  ['dock', 'Harbour and dock', 'dark night harbour water', 'weathered wooden dock planks', 'wooden dock edge', 'dock'],
  ['park', 'Grass and plaza', 'dark green grass', 'purple-grey paved plaza stones', 'stone border', 'canal'],
];
const PNG = (path) => ({ type: 'base64', base64: readFileSync(path).toString('base64'), format: 'png' });

/**
 * Where each tileset goes in the game: the map it's shown on, and which of the game's terrain types
 * are its lower and upper terrain (src/field/types.ts TerrainId). src/dev/artswap.ts lays the drawn
 * tiles over those cells when the map is baked; render-maps.mjs photographs the result.
 */
const TERRAIN_PLACE = {
  street: { map: 'lantern_row', lower: ['asphalt', 'puddle'], upper: ['sidewalk'], keep: ['roadline', 'crosswalk', 'grate'] },
  canal: { map: 'lantern_row', lower: ['water'], upper: ['plaza', 'sidewalk', 'alley'] },
  sewer: { map: 'sinkline_1', lower: ['d_water', 'd_shallow'], upper: ['d_floor'] },
  yard: { map: 'rustyard', lower: ['dirt'], upper: ['junk', 'rubble'] },
  // No map has grass beside the plaza: this one shows Lantern Row's plaza paved with its stones.
  park: { map: 'lantern_row', lower: ['grass'], upper: ['plaza'] },
  // No map has docks or planks yet, so the harbour set has no level to go in.
  dock: null,
};

function terrain() {
  return TERRAIN.map(([id, title, lower, upper, transition, place]) => {
    const base = { lower_description: lower, upper_description: upper, transition_description: transition, tile_size: { width: 16, height: 16 }, view: 'high top-down' };
    return {
      id: `terrain.${id}`,
      category: 'Terrain',
      title,
      kind: 'tileset',
      note: TERRAIN_PLACE[id]
        ? `A 16-tile set covering every way the two terrains can meet, laid into ${TERRAIN_PLACE[id].map} (${TERRAIN_PLACE[id].lower.join(', ')} → lower; ${TERRAIN_PLACE[id].upper.join(', ')} → upper) with the level's buildings and props on top. Try ↗ walks it in the game.`
        : 'A 16-tile set covering every way the two terrains can meet. No map has docks or planks yet, so it has no level to be shown in.',
      terrains: TERRAIN_PLACE[id],
      map: TERRAIN_PLACE[id]?.map,
      current: [{ file: `${CUR}/place/${place}.crop.png`, label: 'Now (a patch of the game today)', scale: 1 }],
      options: [
        { id: 'match', kind: 'tileset', cost: 3, body: { ...base, outline: 'lineless', shading: 'basic shading', detail: 'medium detail', color_image: PNG(`media/art-pass/current/place/${place}.crop.png`) }, label: 'Today’s colours', recipe: 'Wang tileset 16 px · palette from the game today · flat shading' },
        { id: 'textured', kind: 'tileset', cost: 3, body: { ...base, outline: 'lineless', shading: 'medium shading', detail: 'medium detail', color_image: PNG(`media/art-pass/current/place/${place}.crop.png`) }, label: 'Today’s colours, more texture', recipe: 'Wang tileset 16 px · palette from the game today · medium shading' },
        { id: 'fresh', kind: 'tileset', cost: 3, body: { ...base, outline: 'lineless', shading: 'medium shading', detail: 'highly detailed' }, label: 'Free palette, more detail', recipe: 'Wang tileset 16 px · no palette · medium shading' },
      ],
    };
  });
}

// ------------------------------------------------------------------ props

const PROP = {
  vending: 'cyberpunk drinks vending machine, magenta body with glowing rows of cans',
  lamp: 'tall thin street lamp post with a warm glowing lamp at the top',
  firebarrel: 'rusty oil drum with a fire burning inside',
  barrel: 'rusty brown metal barrel',
  crates: 'stack of two wooden shipping crates',
  dumpster: 'green metal dumpster with a closed lid',
  trash: 'small pile of black garbage bags',
  car: 'small boxy dark red hatchback car, parked',
  wreck: 'burnt-out rusted car wreck',
  hydrant: 'red fire hydrant',
  bench: 'wooden park bench with metal legs',
  stall: 'street food stall with a red and white striped awning and hanging paper lanterns',
  tree: 'small round city tree with dark green leaves',
  shrine: 'small roadside shrine with a little roof, candles and offerings',
  terminal: 'public info terminal kiosk with a glowing cyan screen',
  barrier: 'red and white striped road barrier',
  tent: 'blue tarp tent with a campfire glow inside',
  arcade: 'arcade cabinet with a glowing screen',
  bed: 'single bed with a red blanket, seen from above',
  cryopod: 'sci-fi cryopod tube with frosted glass and a figure inside, glowing blue',
};
const pngSize = (path) => {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

/** Round 2 props (Mark's review): each needs its own camera, not one setting for all. */
const PROP_FIX = {
  bed: { angle: 'seen from directly above, straight top-down bird’s-eye view, flat, no perspective', short: 'straight down', view: 'high top-down' },
  car: { angle: 'seen from the side in profile, a flat side view facing left, no perspective', short: 'side-on', view: 'side' },
  shrine: { angle: 'seen from the front facing the camera straight on, symmetrical, flat front view, not turned', short: 'front-on', view: 'low top-down' },
  dumpster: { angle: 'seen from the front facing the camera straight on, detailed dents, rust, stickers and a lid handle', short: 'front-on, more detail', view: 'low top-down', detail: 'high detail' },
};

function props() {
  return Object.entries(PROP).map(([kind, desc]) => {
    const cur = `media/art-pass/current/prop/${kind}.png`;
    const { w, h } = pngSize(cur);
    const exact = { width: Math.max(16, step4(w)), height: Math.max(16, step4(h)) };
    const mapSize = { width: Math.max(32, step4(w)), height: Math.max(32, step4(h)) };
    return {
      id: `prop.${kind}`,
      category: 'Props',
      title: kind[0].toUpperCase() + kind.slice(1),
      kind: 'prop',
      note: `Today ${w}x${h}. PixelLab’s map-object tool won’t go below 32 px, so its option can come out bigger than today’s.`,
      current: [{ file: `${CUR}/prop/${kind}.png`, label: 'Now', scale: 1 }],
      options: [
        { id: 'redraw', kind: 'image', size: exact, prompt: `${desc}, top-down 3/4 view game prop, 16-bit JRPG pixel art, two shadow tones, dark outline`, style: cur, styleOptions: { color_palette: true, outline: true, detail: false, shading: false }, cost: 5, label: 'Redraw at today’s size', recipe: `Pro Flash image ${exact.width}x${exact.height} · style: today’s prop` },
        { id: 'mapobj', kind: 'mapobject', size: mapSize, prompt: desc, view: 'high top-down', body: { outline: 'single color outline', shading: 'basic shading', detail: 'medium detail' }, cost: 1, label: 'Map-object tool', recipe: `Map object ${mapSize.width}x${mapSize.height} · high top-down` },
        // Round 1b (Mark, 2026-09-30): the first two often came back turned at an angle ("3/4 view" also means
        // rotated 45°), but the game draws props straight-on. This one asks for the front, facing the camera.
        ...(PROP_FIX[kind]
          ? [
              { id: 'fix', kind: 'image', size: exact, prompt: `${desc}, ${PROP_FIX[kind].angle}, 16-bit JRPG game prop, pixel art, two shadow tones, dark outline`, style: cur, styleOptions: { color_palette: true, outline: true, detail: false, shading: false }, cost: 5, label: 'Round 2: its own camera', recipe: `Pro Flash image ${exact.width}x${exact.height} · style: today’s prop · ${PROP_FIX[kind].short}` },
              { id: 'fixmo', kind: 'mapobject', size: mapSize, prompt: `${desc}, ${PROP_FIX[kind].angle}`, view: PROP_FIX[kind].view, body: { outline: 'single color outline', shading: 'basic shading', detail: PROP_FIX[kind].detail ?? 'medium detail' }, cost: 1, label: 'Round 2: map-object tool', recipe: `Map object ${mapSize.width}x${mapSize.height} · ${PROP_FIX[kind].view} · ${PROP_FIX[kind].short}` },
            ]
          : []),
        { id: 'front', kind: 'mapobject', size: mapSize, prompt: `${desc}, seen from the front facing the camera straight on, symmetrical, flat front view, not turned or rotated, no perspective`, view: 'low top-down', body: { outline: 'single color outline', shading: 'basic shading', detail: 'medium detail' }, cost: 1, label: 'Facing the camera', recipe: `Map object ${mapSize.width}x${mapSize.height} · low top-down, front-on` },
      ],
    };
  });
}

export const GROUPS = { crew, battle, enemies, portraits, npcs, terrain, props };
export { CREW, FIELD_DIRS, STYLE_KIT, WALK, field, step4 };
