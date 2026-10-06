import { ProgressBar as HeroProgressBar } from '@heroui/react';

/**
 * A bar for the Running panel. `value` is how far along the thing is, from 0 to 1, or null when nothing says how far: Claude Code writes no percent for an
 * agent, so a running agent has a bar that moves (an indeterminate one, which has no value for a screen reader either) and a finished one has a full bar.
 * A workflow does have progress, in the agents that are done of the agents that started, and gets a bar with that value.
 *
 * The fill is ink (the `default` color of the theme) on the hairline track: the Look keeps amber for the one or two focal items of a page, and a bar is
 * not one of them. Under a request for reduced motion the moving bar holds still (HeroUI turns its animation off), and the state in words beside it still says "running".
 */
export function ProgressBar({ value, label = 'Progress' }: { value: number | null; label?: string }) {
  // React Aria reads a value from 0 to 100 by default. Whole percents are all that a bar this small can show.
  const percent = value === null ? null : Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <HeroProgressBar aria-label={label} size="sm" color="default" {...(percent === null ? { isIndeterminate: true } : { value: percent })}>
      <HeroProgressBar.Track>
        <HeroProgressBar.Fill />
      </HeroProgressBar.Track>
    </HeroProgressBar>
  );
}
