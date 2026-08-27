// SPDX-License-Identifier: Apache-2.0
//
// Pure Y.Doc mutations/reads for the `polls` map and its `pollVotes`
// answers. See docs/adr/0011-calendar-events.md. Closing a poll into a real
// event is a REST-mediated, single-transaction operation (server-side,
// `withBandDoc`) — `markPollResolved` here is only the doc-mutation half of
// that, meant to be called alongside `createEvent` in the same transaction,
// not on its own.
import * as Y from 'yjs';
import { type AvailabilityAnswer } from '../schemas/availabilityAnswer';
import { type Poll, type PollOption, pollSchema } from '../schemas/poll';

function getPollOrThrow(doc: Y.Doc, pollId: string): Poll {
  const existing = doc.getMap('polls').get(pollId) as Poll | undefined;
  if (!existing) throw new Error(`Poll not found: ${pollId}`);
  return existing;
}

export function listPolls(doc: Y.Doc): Record<string, Poll> {
  return doc.getMap('polls').toJSON() as Record<string, Poll>;
}

export function createPoll(
  doc: Y.Doc,
  input: { title: string; notes?: string; options: Array<{ startsAt: number; endsAt?: number }>; closesAt?: number },
): string {
  const id = crypto.randomUUID();
  const options: PollOption[] = input.options.map((option) => ({ id: crypto.randomUUID(), ...option }));
  const poll = pollSchema.parse({ ...input, options });
  doc.getMap('polls').set(id, poll);
  return id;
}

export function deletePoll(doc: Y.Doc, pollId: string): void {
  doc.transact(() => {
    doc.getMap('polls').delete(pollId);
    const votes = doc.getMap('pollVotes');
    const prefix = `${pollId}:`;
    for (const key of Array.from(votes.keys())) {
      if (key.startsWith(prefix)) votes.delete(key);
    }
  });
}

/** Sets `resolvedEventId` on an already-created poll — see the file header for why this is meant to run inside the same server-side transaction as the event's own creation, never called alone from a client. */
export function markPollResolved(doc: Y.Doc, pollId: string, resolvedEventId: string): void {
  const existing = getPollOrThrow(doc, pollId);
  const updated = pollSchema.parse({ ...existing, resolvedEventId });
  doc.getMap('polls').set(pollId, updated);
}

/**
 * Always the voting user's own `userId`; the server-side hocuspocus guard
 * (docs/adr/0011-calendar-events.md) is what actually stops a client from
 * writing anyone else's vote.
 */
export function votePoll(doc: Y.Doc, pollId: string, optionId: string, userId: string, answer: AvailabilityAnswer): void {
  doc.getMap('pollVotes').set(`${pollId}:${optionId}:${userId}`, answer);
}

/** Every vote for one poll, keyed `<optionId>:<userId>` (the `pollId:` prefix stripped) — feeds `getPollResults` below. */
export function listVotesForPoll(doc: Y.Doc, pollId: string): Record<string, AvailabilityAnswer> {
  const prefix = `${pollId}:`;
  const result: Record<string, AvailabilityAnswer> = {};
  for (const [key, value] of doc.getMap('pollVotes').entries()) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = value as AvailabilityAnswer;
  }
  return result;
}

export interface PollOptionTally {
  optionId: string;
  yes: number;
  maybe: number;
  no: number;
}

/** Pure — `votes` is already scoped to one poll and keyed `<optionId>:<userId>` (see `listVotesForPoll`). */
export function getPollResults(votes: Record<string, AvailabilityAnswer>, options: PollOption[]): PollOptionTally[] {
  return options.map((option) => {
    const tally: PollOptionTally = { optionId: option.id, yes: 0, maybe: 0, no: 0 };
    const prefix = `${option.id}:`;
    for (const [key, answer] of Object.entries(votes)) {
      if (key.startsWith(prefix)) tally[answer] += 1;
    }
    return tally;
  });
}
