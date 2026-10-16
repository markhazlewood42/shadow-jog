// The GitHub API adapter (Command Center revision 3, design.md sections 4.3 and 6). `fetchSnapshot` reads GitHub with two GraphQL calls and returns
// the same types as the local modules. The Vercel functions (step 3) call it. The pure parts (queries, parsers) are in `queries.ts` and `parse.ts`.
export { fetchDecisionForAnswer, fetchSnapshot, graphql } from './fetch';
export type { FetchLike, FetchOptions } from './fetch';
export * from './queries';
export * from './parse';
export type * from './types';
