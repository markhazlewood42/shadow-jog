import { describe, expect, it } from 'vitest';
import type { ChangeEvent } from '../src/shared/types';
import { createHub } from '../src/server/hub';
import { SseReader, getFrom, makeApp } from './helpers';

const docsChange: ChangeEvent = { module: 'docs', at: '2026-10-05T10:00:01.000Z', ids: ['engine/decisions'] };
const gitChange: ChangeEvent = { module: 'git', at: '2026-10-05T10:00:02.000Z' };

describe('the hub', () => {
  it('hub sends hello, then changed events, on /api/events and to subscribers', async () => {
    const { app, deps } = makeApp();
    const { hub } = deps;

    // A direct subscriber (the way a module that reacts to another module listens).
    const direct: ChangeEvent[] = [];
    const unsubscribe = hub.subscribe((e) => direct.push(e));

    // A page connected to the event stream.
    const res = await getFrom(app, '/api/events', deps.config);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const stream = new SseReader(res.body);
    try {
      // 1. The first frame is hello, so a page knows its connection works (and that it is a new one).
      const hello = await stream.next();
      expect(hello.event).toBe('hello');
      expect(JSON.parse(hello.data)).toEqual({ startedAt: deps.startedAt });

      // 2. Then one changed frame for each event published, in order, with the event as its data.
      hub.publish(docsChange);
      hub.publish(gitChange);
      const first = await stream.next();
      const second = await stream.next();
      expect(first.event).toBe('changed');
      expect(JSON.parse(first.data)).toEqual(docsChange);
      expect(second.event).toBe('changed');
      expect(JSON.parse(second.data)).toEqual(gitChange);

      // 3. The direct subscriber got the same two events, and nothing else (hello is not an event).
      expect(direct).toEqual([docsChange, gitChange]);
    } finally {
      await stream.cancel();
    }

    // 4. After unsubscribing, a subscriber hears nothing more.
    unsubscribe();
    hub.publish(docsChange);
    expect(direct).toEqual([docsChange, gitChange]);
  });

  it('delivers an event to every subscriber, and a subscriber that throws does not stop the others', () => {
    const hub = createHub();
    const heard: string[] = [];
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      hub.subscribe(() => {
        throw new Error('a broken listener');
      });
      hub.subscribe((e) => heard.push(`a:${e.module}`));
      const off = hub.subscribe((e) => heard.push(`b:${e.module}`));
      hub.publish(gitChange);
      off();
      hub.publish(docsChange);
    } finally {
      console.error = originalError;
    }
    expect(heard).toEqual(['a:git', 'b:git', 'a:docs']);
    // The broken listener was reported (never swallowed in silence), once for each event.
    expect(errors).toHaveLength(2);
  });

  it('a subscriber that unsubscribes while an event is being delivered does not skip the next one', () => {
    const hub = createHub();
    const heard: string[] = [];
    const offFirst = hub.subscribe(() => {
      heard.push('first');
      offFirst();
    });
    hub.subscribe(() => heard.push('second'));
    hub.publish(gitChange);
    hub.publish(gitChange);
    expect(heard).toEqual(['first', 'second', 'second']);
  });
});
