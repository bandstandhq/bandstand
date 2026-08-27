// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { pollOptionSchema, pollSchema } from './poll';

describe('pollOptionSchema', () => {
  it('accepts an option with just a start time', () => {
    expect(() => pollOptionSchema.parse({ id: 'opt-1', startsAt: 1_700_000_000_000 })).not.toThrow();
  });

  it('accepts an option with an end time too', () => {
    expect(() =>
      pollOptionSchema.parse({ id: 'opt-1', startsAt: 1_700_000_000_000, endsAt: 1_700_010_000_000 }),
    ).not.toThrow();
  });
});

describe('pollSchema', () => {
  function baseOptions() {
    return [
      { id: 'opt-1', startsAt: 1_700_000_000_000 },
      { id: 'opt-2', startsAt: 1_700_100_000_000 },
    ];
  }

  it('accepts a minimal open poll', () => {
    expect(() => pollSchema.parse({ title: 'When works?', options: baseOptions() })).not.toThrow();
  });

  it('accepts a closed poll resolved into an event', () => {
    expect(() =>
      pollSchema.parse({
        title: 'When works?',
        notes: 'Pick a Saturday',
        options: baseOptions(),
        closesAt: 1_699_999_000_000,
        resolvedEventId: 'event-1',
      }),
    ).not.toThrow();
  });

  it('rejects a poll with no options', () => {
    expect(() => pollSchema.parse({ title: 'When works?', options: [] })).toThrow();
  });

  it('rejects an empty title', () => {
    expect(() => pollSchema.parse({ title: '', options: baseOptions() })).toThrow();
  });
});
