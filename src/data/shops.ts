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
    items: ['iron_knuckles', 'shock_knuckles', 'vibro_katana', 'heavy_pistol', 'taser_pistol', 'bone_staff', 'flashbang', 'frag'],
  },
  lr_armor: {
    id: 'lr_armor', name: 'KOWLOON THREADS', keeper: 'Auntie Wen', accent: '#b07cff',
    greeting: 'Fashion that stops bullets. Mostly.',
    thanks: 'You wear it well. Try not to bleed on it.',
    items: ['armored_jacket', 'lined_coat', 'bandana', 'helmet', 'tac_visor', 'spirit_band', 'spirit_fetish', 'lucky_coin'],
  },
  noodles: {
    id: 'noodles', name: 'MAMA ONO\'S', keeper: 'Mama Ono', accent: '#ff8a4a',
    greeting: 'Sit, sit! You look like a bag of wet bones.',
    thanks: 'Eat it hot!',
    items: ['noodles'],
  },
  clinic: {
    id: 'clinic', name: 'DOC YUN\'S CLINIC', keeper: 'Doc Yun', accent: '#62e06a',
    greeting: 'Pharmacy counter. No questions, no receipts.',
    thanks: 'Keep your insides inside.',
    items: ['medkit', 'trauma_patch', 'detox', 'omni_patch', 'adrenal_stim', 'neurotab'],
  },
  rustyard: {
    id: 'rustyard', name: 'MAGS\' SALVAGE', keeper: 'Old Mags', accent: '#86f08c',
    greeting: 'Salvage, scrap, and things that fell off trucks. Don\'t ask which trucks.',
    thanks: 'Pleasure. Mostly mine.',
    items: ['trauma_patch', 'medkit', 'neurotab', 'mono_claws', 'ballistic_vest', 'spirit_robe', 'dermal_plating', 'neural_buffer', 'cyber_eye', 'reflex_booster', 'adrenal_pump'],
  },
  automat: {
    id: 'automat', name: 'TRANSIT AUTOMAT', keeper: 'Automat', accent: '#3fe0f0',
    greeting: 'WELCOME, VALUED COMMUTER. SERVICE HAS BEEN SUSPENDED SINCE 2061.',
    thanks: 'THANK YOU. MIND THE GAP.',
    items: ['medkit', 'neurotab', 'detox', 'optic_flush', 'getaway_chit'],
  },
};
