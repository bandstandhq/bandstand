// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { closePollInputSchema, pollOptionSchema, pollSchema } from './poll';

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

describe('closePollInputSchema', () => {
  it('accepts a minimal close request', () => {
    expect(() =>
      closePollInputSchema.parse({ optionId: 'opt-1', title: 'Agreed rehearsal', type: 'rehearsal' }),
    ).not.toThrow();
  });

  it('accepts an optional location/notes', () => {
    expect(() =>
      closePollInputSchema.parse({
        optionId: 'opt-1',
        title: 'Agreed gig',
        type: 'gig',
        location: 'The Venue',
        notes: 'Load in at 6pm',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown field (strict)', () => {
    expect(() =>
      closePollInputSchema.parse({ optionId: 'opt-1', title: 'x', type: 'gig', extra: 'nope' }),
    ).toThrow();
  });

  it('rejects a missing optionId or title', () => {
    expect(() => closePollInputSchema.parse({ title: 'x', type: 'gig' })).toThrow();
    expect(() => closePollInputSchema.parse({ optionId: 'opt-1', type: 'gig' })).toThrow();
  });
});
