import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The game's Vercel project deploys only the `release` branch (docs/DEVELOPING.md section 9, "Deploying a release").
// Every other branch push made a deployment before, and the Hobby plan allows 100 a day across all projects (Mark, 2026-10-13).
const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('vercel.json', () => {
  it('deploys only release: main and every other branch make no deployment', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as { git?: { deploymentEnabled?: unknown } };
    expect(config.git?.deploymentEnabled).toEqual({ '**': false, release: true });
  });
});
