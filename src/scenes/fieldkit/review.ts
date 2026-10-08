/**
 * The pop-in table (`popins.ts`, decision D17) is in the dev build only, until Mark answers D17 at
 * Review 3. Every item ships `none`, so a production build needs none of its code: here
 * `import.meta.env.DEV` is false, the bundler folds `popins` to null, and `popins.ts` drops out of
 * the bundle. The callers use `popins?.` and fall back to what ships (no camera limit, no
 * curtain, no hold). When he picks an item, make `popins` the module itself in the same commit.
 */
import * as popinsModule from './popins';

export const popins = import.meta.env.DEV ? popinsModule : null;
