// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createPoll,
  deletePoll,
  getPollResults,
  listPolls,
  listVotesForPoll,
  markPollResolved,
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
