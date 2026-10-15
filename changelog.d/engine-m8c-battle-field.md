### Changed
- Engine: the battle and field scenes are now native `sje` scenes over the battle and field stages. No scene uses the old engine `Scene` any more. Effects go through `game.fx`. The game looks and plays the same.
- Engine: the battle windows, text and menus (tell, banners, messages, help lines, target box, command and list menus, party cards, enemy status, victory and level-up panels) and the field objective box text and banner text are built from the UI kit. Art, sprites and semi-clear plates stay canvas pictures.
- Bundle budget: the game total cap is raised to 475.5 kB (was 473.8, Mark agreed) until the old engine is deleted in M8d. The build measures 474.8 kB.
