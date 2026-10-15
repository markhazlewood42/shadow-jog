### Changed
- Engine: all 13 UI scenes are now native `sje` scenes built from the UI kit: card, controls, game over, ending, place map, save and load, options, dialog, title, shop, Hex's deck, comic panels and the field menu. The game looks and plays the same.
- Engine: `UiScene` base class, `ActionMap.keyName` (the key legend shows the player's own keys) and a UI sound map for the kit.
- Dialog and shop can save and restore their state and step their animation by a set number of ticks (for the editors).
- Bundle budget: the M8b build is over the old caps, so the caps are raised (Mark agreed): first play 412 kB (was 408) and game total 473.8 kB (was 468.5). The build measures 410.8 kB and 472.7 kB.
