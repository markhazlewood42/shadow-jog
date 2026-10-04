/**
 * Every dev tool for the game, in one list: the DEV menu on the game page (src/dev/devmenu.ts)
 * shows it, and `npm run dev` prints it in the terminal (vite.config.ts `devTools`). A new tool,
 * page or route goes here and shows up in both. Paths are relative to the dev server's root.
 */
export interface DevTool {
  name: string;
  path: string;
  /** What it's for, in a few plain words. */
  about: string;
  /** Takes a choice: the menu offers a picker and puts `<param>=<choice>` on the path. */
  pick?: 'map' | 'stage';
  /** Printed in the terminal at startup (the main tools; the rest are in the menu). */
  print?: boolean;
}

export const DEV_TOOLS: { group: string; tools: DevTool[] }[] = [
  {
    group: 'Editors',
    tools: [
      { name: 'FX lab (particle effects editor)', path: '/?scene=fxlab', about: 'Tune particle presets and what plays at each battle moment; Save writes src/data/fx.json', print: true },
      { name: 'Animation editor', path: '/rigedit.html', about: 'Pose the crew’s battle arms on their skeletons; ask Claude to fix a pose', print: true },
      { name: 'Art review', path: '/artreview.html', about: 'Every version of the code-drawn art side by side; flag frames, leave notes', print: true },
      { name: 'Battle Stage Editor (Phaser spike)', path: '/stageedit.html', about: 'Drag the horizon, floor, depth rows, heroes, enemies and HUD boxes on the live battle stage; Save writes src/data/stages.json, axes.json, hud.json (the one HUD every battle uses) and enemyfacing.json (which enemies are mirrored to face the heroes); Battle Test (Ctrl+Enter) plays a real fight on the stage as it is in the page, saved or not', print: true },
    ],
  },
  {
    group: 'Jump into the game',
    tools: [
      { name: 'Battle', path: '/?debug&scene=battle', about: 'A street fight on loop, full party at level 6', print: true },
      { name: 'Boss battle', path: '/?debug&scene=battle&enemies=lurker&boss', about: 'The Lurker, on loop' },
      { name: 'A point in the story', path: '/?debug&scene=stage', about: 'Straight to a chapter preset: the party, levels and gear for that point', pick: 'stage' },
      { name: 'Debug mode', path: '/?debug', about: 'The normal game, with test hooks on window.__SJ__ (see the console)' },
    ],
  },
  {
    group: 'Look at the art',
    tools: [
      { name: 'Map view', path: '/?scene=mapview', about: 'A whole map rendered at once', pick: 'map' },
      { name: 'Stage lab (Phaser spike)', path: '/stagelab.html', about: 'Spike: the side-view battle stage in Phaser 4 from src/data/stages.json: street and sewer, painted floor, depth rows, HUD; pick the stage, enemy group and moment of the turn (the crew need the spritefusion-tests link, else stand-ins)' },
      { name: 'Characters', path: '/?scene=chars&zoom=4', about: 'The crew’s sprites, every facing and walk' },
      { name: 'NPCs and townsfolk', path: '/?scene=chars&zoom=4&npcs', about: 'Everyone else’s sprites' },
      { name: 'Battle backs', path: '/?scene=chars&zoom=2&battlers', about: 'The crew from behind, every pose' },
      { name: 'Side-view arm lab (field scale)', path: '/?scene=sidelab&scale=field', about: 'Spike: Rook seen from the side, the near arm cut out and posed' },
      { name: 'Side-view arm lab (battle scale)', path: '/?scene=sidelab&scale=battle', about: 'Spike: the same at ~46 px, shrunk from the traced west view' },
      { name: 'Portraits', path: '/?scene=portraits', about: 'Every speaker’s expressions' },
      { name: 'Bestiary', path: '/?scene=bestiary', about: 'The enemies, page by page' },
      { name: 'Font', path: '/?scene=font', about: 'The game’s pixel font' },
    ],
  },
  {
    group: 'Compare art',
    tools: [
      { name: 'Old code-drawn characters', path: '/?rig=old', about: 'Without rig v2 (the traced, code-animated art)' },
      { name: 'No PixelLab art', path: '/?art=classic', about: 'Tilesets and props as code drew them' },
      { name: 'All PixelLab picks', path: '/?art=drawn', about: 'Every picked PixelLab image, characters too' },
    ],
  },
];
