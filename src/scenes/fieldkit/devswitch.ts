/**
 * A review switch: a value that Mark's review pictures force from the page address, so one build
 * can show every option of an open decision (`?surround=b2`, `?popin=b`). It is dev only. A
 * production build never reads the address (`import.meta.env.DEV` is false there, so the check is
 * dropped), and a unit test has no `location`, so the switch is off there too. The caller falls
 * back to what the game ships.
 */
export function reviewSwitch(name: string): string | null {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(name);
}
