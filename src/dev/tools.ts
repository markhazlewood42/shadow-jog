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
    ],
  },
  {
    group: 'Jump into the game',
    tools: [
      { name: 'Battle', path: '/?debug&scene=battle', about: 'A street fight on loop, full party at level 6', print: true },
      { name: 'Boss battle', path: '/?debug&scene=battle&enemies=lurker&boss', about: 'The Lurker, on loop' },
      { name: 'Dialog box, full width (D8)', path: '/?debug&scene=field&map=lantern_row&x=22&y=8&dialogw=full', about: 'Dialogue in a box as wide as the screen (608 px), not the shipped one capped at 464. A review switch, dev only: add &dialogw=full to any route' },
      { name: 'Menu panes, stretched (D8)', path: '/?debug&scene=field&map=lantern_row&x=22&y=8&panes=stretch', about: 'The field menu (press C) with its list panes as wide as the screen allows, not the shipped ones capped at 364 px. A review switch, dev only: add &panes=stretch to any route' },
      { name: 'Title, 5x logo (D9)', path: '/?logo=5', about: 'The title with the logo at 5x, not the shipped 4x. A review switch, dev only: add &logo=5 to the title route' },
      { name: 'Comic panels, 3x portraits (D9)', path: '/?scene=panels&id=ending&portrait=3', about: 'The ending pages with every portrait at 3x, not the shipped 2x (id=intro for the opening). A review switch, dev only: add &portrait=3 to any panel route' },
      { name: 'A point in the story', path: '/?debug&scene=stage', about: 'Straight to a chapter preset: the party, levels and gear for that point', pick: 'stage' },
      { name: 'Debug mode', path: '/?debug', about: 'The normal game, with test hooks on window.__SJ__ (see the console)' },
    ],
  },
  {
    group: 'Look at the art',
    tools: [
      { name: 'Map view', path: '/?scene=mapview', about: 'A whole map rendered at once', pick: 'map' },
      { name: 'Characters', path: '/?scene=chars&zoom=4', about: 'The crew’s sprites, every facing and walk' },
      { name: 'NPCs and townsfolk', path: '/?scene=chars&zoom=4&npcs', about: 'Everyone else’s sprites' },
      { name: 'Battle backs', path: '/?scene=chars&zoom=2&battlers', about: 'The crew from behind, every pose' },
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
