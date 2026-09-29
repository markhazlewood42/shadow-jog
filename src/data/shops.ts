/** Shop inventories. */
export interface ShopDef {
  id: string;
  name: string;
  keeper: string;
  greeting: string;
  thanks: string;
  items: string[];
  accent: string;
}

export const SHOPS: Record<string, ShopDef> = {
  lr_items: {
    id: 'lr_items', name: 'KWIK-MART 24/7', keeper: 'Clerk', accent: '#62e0c0',
    greeting: 'Welcome to Kwik-Mart. We never close. Ever. Please help.',
    thanks: 'Thank you, come again. Please.',
    items: ['medkit', 'detox', 'optic_flush', 'neurotab', 'smoke_pellet', 'getaway_chit', 'cab_voucher'],
  },
  lr_weapons: {
    id: 'lr_weapons', name: 'IRON SAINT ARMS', keeper: 'Brother Tomas', accent: '#ff6a3a',
    greeting: 'Every blade here is blessed. The guns are just loaded.',
    thanks: 'Go with steel.',
    items: ['iron_knuckles', 'shock_knuckles', 'vibro_katana', 'nodachi', 'heavy_pistol', 'flechette_pistol', 'taser_pistol', 'bone_staff', 'flashbang', 'frag', 'toxin_dart'],
  },
  lr_armor: {
    id: 'lr_armor', name: 'KOWLOON THREADS', keeper: 'Auntie Wen', accent: '#b07cff',
    greeting: 'Fashion that stops bullets. Mostly.',
    thanks: 'You wear it well. Try not to bleed on it.',
    items: ['armored_jacket', 'lined_coat', 'bandana', 'helmet', 'tac_visor', 'spirit_band', 'spirit_fetish', 'lucky_coin', 'ki_beads', 'ronin_guard'],
  },
  noodles: {
    id: 'noodles', name: 'MAMA ONO’S', keeper: 'Mama Ono', accent: '#ff8a4a',
    greeting: 'Sit, sit! You look like a bag of wet bones.',
    thanks: 'Eat it hot!',
    items: ['noodles'],
  },
  clinic: {
    id: 'clinic', name: 'DOC YUN’S CLINIC', keeper: 'Doc Yun', accent: '#62e06a',
    greeting: 'Pharmacy counter. No questions, no receipts.',
    thanks: 'Keep your insides inside.',
    items: ['medkit', 'trauma_patch', 'detox', 'omni_patch', 'adrenal_stim', 'neurotab'],
  },
  rustyard: {
    id: 'rustyard', name: 'MAGS’ SALVAGE', keeper: 'Old Mags', accent: '#86f08c',
    greeting: 'Salvage, scrap, and things that fell off trucks. Don’t ask which trucks.',
    thanks: 'Pleasure. Mostly mine.',
    items: ['trauma_patch', 'medkit', 'neurotab', 'razor_tekko', 'mono_claws', 'thorn_rod', 'ballistic_vest', 'spirit_robe', 'dermal_plating', 'neural_buffer', 'cyber_eye', 'reflex_booster', 'adrenal_pump'],
  },
  fence: {
    id: 'fence', name: 'WIRE’S STASH', keeper: 'Wire', accent: '#ff4fb0',
    greeting: 'Runners get runner prices. Everyone else gets shot. You look like runners.',
    thanks: 'Pleasure. Don’t tell anyone where I sleep.',
    // Wire's line is the black-market stuff: stims, darts, grenades, the taser. Only the two
    // pieces you need for the Lurker overlap with Mags, so nobody has to walk back up top.
    items: ['trauma_patch', 'neurotab', 'adrenal_stim', 'omni_patch', 'toxin_dart', 'flashbang', 'mono_claws', 'taser_pistol', 'ballistic_vest', 'formfit', 'coolant_rig'],
  },
  // Annex 7, outside the Warden chamber: the last place to spend before the job goes wrong.
  km_requisition: {
    id: 'km_requisition', name: 'K-M REQUISITION', keeper: 'Terminal', accent: '#ff6a5a',
    greeting: 'BADGE ACCEPTED: D. PETROV, FACILITIES. REQUISITION LIMIT: UNLIMITED.',
    thanks: 'CHARGED TO COST CENTRE 7. HAVE A PRODUCTIVE SHIFT.',
    // Consumables, plus the lab's top gear: a fallback for anyone who missed the armory cases,
    // and the Neural Lace for anyone who kept their money.
    items: ['medkit', 'trauma_patch', 'omni_patch', 'neurotab', 'adrenal_stim', 'detox', 'optic_flush', 'frag', 'arc_gauntlets', 'thermal_katana', 'burst_smg', 'ward_staff', 'km_lace', 'crow_torc'],
  },
  automat: {
    id: 'automat', name: 'TRANSIT AUTOMAT', keeper: 'Automat', accent: '#3fe0f0',
    greeting: 'WELCOME, VALUED COMMUTER. SERVICE HAS BEEN SUSPENDED SINCE 2061.',
    thanks: 'THANK YOU. MIND THE GAP.',
    items: ['medkit', 'neurotab', 'detox', 'optic_flush', 'getaway_chit'],
  },
};
