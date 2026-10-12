import { execFileSync } from 'node:child_process';
import { fetchSnapshot } from '../src/github-api/fetch';

// A dry run of the GitHub API adapter against the real repo (design.md section 11.3, step 2).
//
// It takes the token from `gh auth token` at run time. It never writes the token, and it writes no file: it prints counts only (no titles, no text).
// Run it from tools/command-center:  npx tsx scripts/github-api-dry-run.ts

function tokenFromGh(): string {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('gh auth token failed: run "gh auth login" first');
  }
}

const started = Date.now();
const result = await fetchSnapshot({ token: tokenFromGh() });
const seconds = ((Date.now() - started) / 1000).toFixed(1);

if (!result.ok) {
  console.error(`FAILED (${result.error.code}): ${result.error.message}`);
  process.exit(1);
}
const snapshot = result.data;
const rows = snapshot.workstreams;
const found = rows.filter((row) => row.workstream?.ok === true).length;
const invalid = rows.filter((row) => row.workstream?.ok === false).length;
const neutral = rows.filter((row) => row.workstream === null).length;
const points = snapshot.cost.reduce((sum, entry) => sum + entry.cost, 0);

console.log(`branches:            ${snapshot.branches.length}`);
console.log(`pull requests:       ${snapshot.github.open.length} open, ${snapshot.github.merged.length} merged in the last 7 days`);
console.log(`CI on main:          ${snapshot.ci.state}`);
console.log(`workstream rows:     ${rows.length} (${found} valid file, ${invalid} invalid or red, ${neutral} neutral)`);
console.log(`decisions:           ${snapshot.decisions.open.length} open, ${snapshot.decisions.recent.length} answered in the last 7 days`);
console.log(`files of main read:  status ${snapshot.main.status !== null}, roadmap ${snapshot.main.roadmap !== null}, migration ${snapshot.main.migration !== null}`);
for (const entry of snapshot.cost) console.log(`rate limit:          ${entry.call}: cost ${entry.cost}, remaining ${entry.remaining}`);
console.log(`calls: ${snapshot.cost.length}, points: ${points}, time: ${seconds} s`);
for (const problem of snapshot.problems) console.log(`problem:             [${problem.code}] ${problem.message}`);
