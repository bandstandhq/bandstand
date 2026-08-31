// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  addPollOption,
  createPoll,
  deletePoll,
  getPollResults,
  listPolls,
  listVotesForPoll,
  markPollResolved,
  rankPollOptions,
  updatePoll,
  votePoll,
} from './polls';

function baseInput() {
  return {
    title: 'When works?',
    options: [{ startsAt: 1_700_000_000_000 }, { startsAt: 1_700_100_000_000 }],
  };
}

describe('createPoll', () => {
  it('generates ids for each option', () => {
    const doc = new Y.Doc();
    const id = createPoll(doc, baseInput());

    const poll = listPolls(doc)[id];
    expect(poll?.options).toHaveLength(2);
    expect(poll?.options[0]?.id).toBeTruthy();
    expect(poll?.options[0]?.id).not.toBe(poll?.options[1]?.id);
  });
});

describe('votePoll / listVotesForPoll', () => {
  it('scopes votes to one poll, stripping the pollId prefix', () => {
    const doc = new Y.Doc();
    const pollId = createPoll(doc, baseInput());
    const otherPollId = createPoll(doc, baseInput());
    const [optionA, optionB] = listPolls(doc)[pollId]!.options;

    votePoll(doc, pollId, optionA!.id, 'u1', 'yes');
    votePoll(doc, pollId, optionB!.id, 'u1', 'no');
    votePoll(doc, otherPollId, optionA!.id, 'u1', 'maybe'); // different poll, must not leak in

    const votes = listVotesForPoll(doc, pollId);
    expect(votes).toEqual({
      [`${optionA!.id}:u1`]: 'yes',
      [`${optionB!.id}:u1`]: 'no',
    });
  });

  it('overwrites a user\'s own prior vote on the same option', () => {
    const doc = new Y.Doc();
    const pollId = createPoll(doc, baseInput());
    const optionA = listPolls(doc)[pollId]!.options[0]!;

    votePoll(doc, pollId, optionA.id, 'u1', 'yes');
    votePoll(doc, pollId, optionA.id, 'u1', 'maybe');

    expect(listVotesForPoll(doc, pollId)).toEqual({ [`${optionA.id}:u1`]: 'maybe' });
  });
});

describe('getPollResults', () => {
  it('tallies each option\'s votes independently', () => {
    const options = [{ id: 'opt-a', startsAt: 1 }, { id: 'opt-b', startsAt: 2 }];
    const votes = {
      'opt-a:u1': 'yes' as const,
      'opt-a:u2': 'yes' as const,
      'opt-a:u3': 'maybe' as const,
      'opt-b:u1': 'no' as const,
    };

    expect(getPollResults(votes, options)).toEqual([
      { optionId: 'opt-a', yes: 2, maybe: 1, no: 0 },
      { optionId: 'opt-b', yes: 0, maybe: 0, no: 1 },
    ]);
  });

  it('an option nobody voted on tallies to all zeros', () => {
    expect(getPollResults({}, [{ id: 'opt-a', startsAt: 1 }])).toEqual([
      { optionId: 'opt-a', yes: 0, maybe: 0, no: 0 },
    ]);
  });
});

describe('markPollResolved', () => {
  it('sets resolvedEventId, leaving everything else unchanged', () => {
    const doc = new Y.Doc();
    const pollId = createPoll(doc, baseInput());

    markPollResolved(doc, pollId, 'event-1');

    expect(listPolls(doc)[pollId]).toMatchObject({ title: 'When works?', resolvedEventId: 'event-1' });
  });

  it('throws resolving a nonexistent poll', () => {
    const doc = new Y.Doc();
    expect(() => markPollResolved(doc, 'missing', 'event-1')).toThrow('Poll not found');
  });
});

describe('updatePoll', () => {
  it('edits title/notes without touching options or votes', () => {
    const doc = new Y.Doc();
    const pollId = createPoll(doc, baseInput());
    const originalOptions = listPolls(doc)[pollId]!.options;
    const optionA = originalOptions[0]!;
    votePoll(doc, pollId, optionA.id, 'u1', 'yes');

    updatePoll(doc, pollId, { title: 'When really works?', notes: 'Bring your own amp' });

    const poll = listPolls(doc)[pollId]!;
    expect(poll.title).toBe('When really works?');
    expect(poll.notes).toBe('Bring your own amp');
    expect(poll.options).toEqual(originalOptions);
    expect(listVotesForPoll(doc, pollId)).toEqual({ [`${optionA.id}:u1`]: 'yes' });
  });

  it('throws for a missing poll', () => {
    const doc = new Y.Doc();
    expect(() => updatePoll(doc, 'missing', { title: 'x' })).toThrow('Poll not found');
  });
});

describe('addPollOption', () => {
  it('appends a new option, leaving existing options and votes untouched', () => {
    const doc = new Y.Doc();
    const pollId = createPoll(doc, baseInput());
    const optionA = listPolls(doc)[pollId]!.options[0]!;
    votePoll(doc, pollId, optionA.id, 'u1', 'yes');

    addPollOption(doc, pollId, { startsAt: 1_700_200_000_000 });

    const poll = listPolls(doc)[pollId]!;
    expect(poll.options).toHaveLength(3);
    expect(poll.options[0]).toEqual(optionA);
    expect(poll.options[2]!.startsAt).toBe(1_700_200_000_000);
    expect(poll.options[2]!.id).not.toBe(optionA.id);
    expect(listVotesForPoll(doc, pollId)).toEqual({ [`${optionA.id}:u1`]: 'yes' });
  });

  it('throws for a missing poll', () => {
    const doc = new Y.Doc();
    expect(() => addPollOption(doc, 'missing', { startsAt: 1 })).toThrow('Poll not found');
  });
});

describe('rankPollOptions', () => {
  it('orders by yes votes, then maybe votes, then original order — numbering every option', () => {
    const options = [
      { id: 'opt-a', startsAt: 1 },
      { id: 'opt-b', startsAt: 2 },
      { id: 'opt-c', startsAt: 3 },
      { id: 'opt-d', startsAt: 4 },
    ];
    const votes = {
      'opt-a:u1': 'yes' as const,
      'opt-b:u1': 'yes' as const,
      'opt-b:u2': 'yes' as const,
      'opt-c:u1': 'maybe' as const,
      // opt-d: no votes at all.
    };

    expect(rankPollOptions(votes, options)).toEqual([
      { optionId: 'opt-b', yes: 2, maybe: 0, no: 0, rank: 1 },
      { optionId: 'opt-a', yes: 1, maybe: 0, no: 0, rank: 2 },
      { optionId: 'opt-c', yes: 0, maybe: 1, no: 0, rank: 3 },
      { optionId: 'opt-d', yes: 0, maybe: 0, no: 0, rank: 4 },
    ]);
  });

  it('breaks a full tie by original option order', () => {
    const options = [{ id: 'opt-a', startsAt: 1 }, { id: 'opt-b', startsAt: 2 }];
    expect(rankPollOptions({}, options).map((r) => r.optionId)).toEqual(['opt-a', 'opt-b']);
  });
});

describe('deletePoll', () => {
  it('removes the poll and every one of its votes', () => {
    const doc = new Y.Doc();
    const pollId = createPoll(doc, baseInput());
    const otherPollId = createPoll(doc, baseInput());
    const optionA = listPolls(doc)[pollId]!.options[0]!;
    const otherOptionA = listPolls(doc)[otherPollId]!.options[0]!;
    votePoll(doc, pollId, optionA.id, 'u1', 'yes');
    votePoll(doc, otherPollId, otherOptionA.id, 'u1', 'yes');

    deletePoll(doc, pollId);

    expect(listPolls(doc)[pollId]).toBeUndefined();
    expect(listVotesForPoll(doc, pollId)).toEqual({});
    expect(listVotesForPoll(doc, otherPollId)).toEqual({ [`${otherOptionA.id}:u1`]: 'yes' });
  });
});
