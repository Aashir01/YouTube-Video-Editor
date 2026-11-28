import { describe, expect, it } from 'vitest';
import { autopilotOrder, nextSlot, planSchedule, shortMetadata } from './autopilot';
import type { Moment } from './moments';

describe('Shorts autopilot', () => {
  it('spaces the publish times evenly from the first one', () => {
    expect(planSchedule(3, '2026-12-01T12:00:00.000Z', 24)).toEqual(['2026-12-01T12:00:00.000Z', '2026-12-02T12:00:00.000Z', '2026-12-03T12:00:00.000Z']);
    expect(planSchedule(2, '2026-12-01T12:00:00.000Z', 0.2)[1]).toBe('2026-12-01T13:00:00.000Z');
    expect(() => planSchedule(1, 'soon', 24)).toThrow(/valid date/);
  });

  it('picks the next 5 pm that is far enough away', () => {
    const at = (h: number, m = 0) => new Date(2026, 11, 1, h, m);
    expect(nextSlot(at(9))).toEqual(new Date(2026, 11, 1, 17));
    expect(nextSlot(at(16, 30))).toEqual(new Date(2026, 11, 2, 17));
    expect(nextSlot(at(20))).toEqual(new Date(2026, 11, 2, 17));
  });

  it('posts the best first, ties in video order', () => {
    const m = (id: string, score: number, start: number) => ({ id, score, start }) as Moment;
    expect(autopilotOrder([m('a', 6, 0), m('b', 9, 50), m('c', 9, 10)]).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('writes the Short its title, hook, a link to the full video and #Shorts', () => {
    const meta = shortMetadata({ title: 'The secret nobody shares', hook: 'Here is the secret.' }, { title: 'Grow on YouTube', videoId: 'abc123', hashtags: ['#growth', 'shorts'] });
    expect(meta).toEqual({ title: 'The secret nobody shares', description: 'Here is the secret.\n\nFull video: https://youtu.be/abc123', hashtags: ['Shorts', 'growth'] });
    expect(shortMetadata({ title: 'x', hook: '' }, { title: 'Grow', hashtags: [] }).description).toBe('From "Grow"');
  });
});
