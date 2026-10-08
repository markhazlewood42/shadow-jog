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
      { name: 'Small map, edge fill (D7 b1)', path: '/?debug&scene=field&map=dock&x=10&y=7&surround=b1', about: 'Loading Dock 7 with its edge tiles repeated outward. A review switch, dev only: add &surround=a|b1|b2 to any small map' },
      { name: 'Pop-in items, option b (D17)', path: '/?debug&scene=field&map=rustyard&x=15&y=22&popin=all:b', about: 'The Rustyard with its curtain over the depot crew. A review switch, dev only: add &popin=P1:b,P4:a (items P1 to P4, options a or b) to any map; the list is media/pivot-640/wp3/popins.md' },
      { name: 'Small map, themed surround (D7 b2)', path: '/?debug&scene=field&map=dock&x=10&y=7&surround=b2', about: 'Loading Dock 7 on a quay over water. The Rustyard and the nine interiors have their own themes (review switch, dev only)' },
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
