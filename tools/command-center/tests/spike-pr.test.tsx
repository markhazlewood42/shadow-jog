// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pr } from '../fixtures/hosted/world';
import { isSpikePr, shownOpenPrs } from '../src/shared/spike-pr';
import type { GithubInfo } from '../src/shared/types';
import { PullRequestList } from '../src/web/now/PullRequestsPanel';

// The "never merge" spike pull requests (src/shared/spike-pr.ts): open, draft, from a `spike/` branch. The Pull requests panel hides them on both pages (the local page
// and the hosted page render this same list), and its "Open (n)" count counts only the pull requests that it shows. The hide is display-only.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('isSpikePr', () => {
  it('is true for an open draft pull request from a spike/ branch', () => {
    expect(isSpikePr(pr(3, 'spike/side-battle', { isDraft: true }))).toBe(true);
    expect(isSpikePr(pr(11, 'spike/engine/platform', { isDraft: true }))).toBe(true);
  });

  it('is false for a spike/ branch that is not a draft, and for a draft from any other branch', () => {
    expect(isSpikePr(pr(1, 'spike/ready', { isDraft: false }))).toBe(false);
    expect(isSpikePr(pr(2, 'engine-m6-flip', { isDraft: true }))).toBe(false);
    // The prefix is the folder `spike/`: a name that only starts with the letters is not one, and neither is a branch that holds the word later.
    expect(isSpikePr(pr(3, 'spikes/a', { isDraft: true }))).toBe(false);
    expect(isSpikePr(pr(4, 'spike-a', { isDraft: true }))).toBe(false);
    expect(isSpikePr(pr(5, 'feature/spike/a', { isDraft: true }))).toBe(false);
  });

  it('is false for a pull request that is not open', () => {
    expect(isSpikePr(pr(6, 'spike/old', { isDraft: true, state: 'MERGED' }))).toBe(false);
    expect(isSpikePr(pr(7, 'spike/old', { isDraft: true, state: 'CLOSED' }))).toBe(false);
  });

  it('shownOpenPrs drops the spikes, keeps the others in order, and does not change its input', () => {
    const open = [pr(3, 'spike/side-battle', { isDraft: true }), pr(20, 'alpha'), pr(4, 'spike/phaser-stage', { isDraft: true }), pr(21, 'spike/ready'), pr(22, 'beta', { isDraft: true })];
    expect(shownOpenPrs(open).map((entry) => entry.number)).toEqual([20, 21, 22]);
    expect(open).toHaveLength(5);
  });
});

describe('the Pull requests list', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const show = async (info: GithubInfo) => {
    await act(async () => {
      root.render(<PullRequestList info={info} now={Date.now()} repo="fixture-owner/fixture-repo" repoFailed={false} />);
    });
    return container.textContent ?? '';
  };

  it('hides the spike PRs and counts only the PRs it shows; a non-draft spike/ PR and a draft from another branch stay', async () => {
    const text = await show({
      open: [
        pr(3, 'spike/side-battle', { isDraft: true, title: 'Spike side battle' }),
        pr(4, 'spike/phaser-stage', { isDraft: true, title: 'Spike phaser stage' }),
        pr(30, 'alpha', { title: 'Alpha work' }),
        pr(31, 'spike/ready', { isDraft: false, title: 'Ready spike branch' }),
        pr(32, 'beta', { isDraft: true, title: 'Beta draft' }),
      ],
      merged: [],
    });
    expect(text).toContain('Open (3)');
    expect(text).not.toContain('Spike side battle');
    expect(text).not.toContain('Spike phaser stage');
    for (const title of ['Alpha work', 'Ready spike branch', 'Beta draft']) expect(text).toContain(title);
  });

  it('says "No open PRs" and counts 0 when only spikes are open, and does not change the data', async () => {
    const info: GithubInfo = { open: [pr(3, 'spike/side-battle', { isDraft: true }), pr(11, 'spike/engine-platform', { isDraft: true })], merged: [] };
    const text = await show(info);
    expect(text).toContain('Open (0)');
    expect(text).toContain('No open PRs');
    expect(info.open).toHaveLength(2);
  });
});
