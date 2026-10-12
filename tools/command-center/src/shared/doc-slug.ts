// The address of a doc on the site, from its id (the path in the repo). Pure, so the decision parser can run on Vercel without the docs index.

/** The address of a doc on the site, from its id (the path in the repo): no `.md` and no leading `docs/`. */
export const slugOf = (id: string): string => id.replace(/\.md$/i, '').replace(/^docs\//, '');
