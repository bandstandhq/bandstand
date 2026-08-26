// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { Anchor } from '../schemas/anchor';
import type { FileRef } from '../files/schema';
import {
  applyAnchorToChordProPosition,
  applyAnchorToFilesPosition,
  computeCurrentAnchorInChordPro,
  computeCurrentAnchorInFiles,
  determineSyncLevel,
  resolveKnownAnchor,
} from './stageSync';

const anchors: Anchor[] = [
  { id: 'intro', label: 'Intro', order: 0 },
  { id: 'verse', label: 'Verse', order: 1 },
  { id: 'chorus', label: 'Chorus', order: 2 },
];

const fileRef = (sha256: string, pageCount = 1): FileRef => ({ sha256, filename: 'part.pdf', mime: 'application/pdf', pageCount });

describe('computeCurrentAnchorInChordPro', () => {
  const sections = [{ label: 'Intro' }, { label: 'Verse' }, { label: null }, { label: 'Chorus' }];

  it('lands exactly on an anchor at fraction 0', () => {
    expect(computeCurrentAnchorInChordPro(anchors, sections, { sectionIndex: 1, fractionInSection: 0 })).toEqual({
      anchorId: 'verse',
      fraction: 0,
    });
  });

  it('interpolates fraction across the span to the next matched anchor', () => {
    // verse (section 1) -> chorus (section 3): halfway is section 2, fraction 0.
    expect(computeCurrentAnchorInChordPro(anchors, sections, { sectionIndex: 2, fractionInSection: 0 })).toEqual({
      anchorId: 'verse',
      fraction: 0.5,
    });
  });

  it('returns fraction 0 (not undefined) when there is no next matched anchor', () => {
    expect(computeCurrentAnchorInChordPro(anchors, sections, { sectionIndex: 3, fractionInSection: 0.9 })).toEqual({
      anchorId: 'chorus',
      fraction: 0,
    });
  });

  it('is undefined before any matched anchor', () => {
    const laterSections = [{ label: null }, { label: 'Verse' }];
    expect(computeCurrentAnchorInChordPro(anchors, laterSections, { sectionIndex: 0, fractionInSection: 0.5 })).toBeUndefined();
  });
});

describe('applyAnchorToChordProPosition', () => {
  const sections = [{ label: 'Intro' }, { label: 'Verse' }, { label: null }, { label: 'Chorus' }];

  it('resolves an anchor to its matched section at fraction 0', () => {
    expect(applyAnchorToChordProPosition(anchors, sections, 'verse', 0)).toEqual({
      sectionIndex: 1,
      fractionInSection: 0,
    });
  });

  it('advances partway toward the next matched anchor per the given fraction', () => {
    expect(applyAnchorToChordProPosition(anchors, sections, 'verse', 0.5)).toEqual({
      sectionIndex: 2,
      fractionInSection: 0,
    });
  });

  it('is fraction 0 with no next matched anchor regardless of the given fraction', () => {
    expect(applyAnchorToChordProPosition(anchors, sections, 'chorus', 0.9)).toEqual({
      sectionIndex: 3,
      fractionInSection: 0,
    });
  });

  it('is undefined for an anchor with no matching section in this voice', () => {
    const noChorus = [{ label: 'Intro' }, { label: 'Verse' }];
    expect(applyAnchorToChordProPosition(anchors, noChorus, 'chorus', 0)).toBeUndefined();
  });
});

describe('computeCurrentAnchorInFiles', () => {
  const files = [fileRef('a'.repeat(64), 4)];
  const anchorMap = {
    intro: { fileIndex: 0, page: 1, yPct: 0 },
    chorus: { fileIndex: 0, page: 3, yPct: 0 },
  };

  it('lands exactly on a calibrated anchor', () => {
    expect(computeCurrentAnchorInFiles(anchors, files, anchorMap, { fileIndex: 0, page: 1, yPct: 0 })).toEqual({
      anchorId: 'intro',
      fraction: 0,
    });
  });

  it('interpolates fraction between page+yPct scalars toward the next calibrated anchor', () => {
    // intro at page 1 (scalar 0), chorus at page 3 (scalar 2) -> page 2 is scalar 1, halfway.
    expect(computeCurrentAnchorInFiles(anchors, files, anchorMap, { fileIndex: 0, page: 2, yPct: 0 })).toEqual({
      anchorId: 'intro',
      fraction: 0.5,
    });
  });

  it('returns fraction 0 with no next calibrated anchor, never a stale nonzero value', () => {
    expect(computeCurrentAnchorInFiles(anchors, files, anchorMap, { fileIndex: 0, page: 4, yPct: 0.9 })).toEqual({
      anchorId: 'chorus',
      fraction: 0,
    });
  });

  it('is undefined with no anchorMap at all', () => {
    expect(computeCurrentAnchorInFiles(anchors, files, undefined, { fileIndex: 0, page: 1, yPct: 0 })).toBeUndefined();
  });

  it('is undefined before any calibrated anchor', () => {
    expect(computeCurrentAnchorInFiles(anchors, files, { chorus: anchorMap.chorus }, { fileIndex: 0, page: 1, yPct: 0 })).toBeUndefined();
  });
});

describe('applyAnchorToFilesPosition', () => {
  const files = [fileRef('a'.repeat(64), 2)];

  it('resolves a calibrated anchor to its current rendered position', () => {
    const anchorMap = { intro: { fileIndex: 0, page: 2, yPct: 0.5 } };
    expect(applyAnchorToFilesPosition(files, undefined, anchorMap, 'intro')).toMatchObject({ position: 1, pageNumberInFile: 2 });
  });

  it('is undefined for an anchor with no calibration in this voice', () => {
    expect(applyAnchorToFilesPosition(files, undefined, {}, 'intro')).toBeUndefined();
    expect(applyAnchorToFilesPosition(files, undefined, undefined, 'intro')).toBeUndefined();
  });
});

describe('resolveKnownAnchor', () => {
  it('returns the anchor itself when it is already known', () => {
    expect(resolveKnownAnchor(anchors, new Set(['intro', 'verse', 'chorus']), 'verse')).toBe('verse');
  });

  it('walks back to the nearest earlier known anchor', () => {
    expect(resolveKnownAnchor(anchors, new Set(['intro']), 'chorus')).toBe('intro');
  });

  it('is undefined when nothing known exists at or before the target', () => {
    expect(resolveKnownAnchor(anchors, new Set(['chorus']), 'intro')).toBeUndefined();
  });

  it('is undefined for a target anchor id not in the song\'s list at all', () => {
    expect(resolveKnownAnchor(anchors, new Set(['intro']), 'nonexistent')).toBeUndefined();
  });
});

describe('determineSyncLevel', () => {
  it('is "offline" whenever offline, regardless of anchors or voices', () => {
    expect(determineSyncLevel({ anchors, resolvedVoices: [], online: false })).toBe('offline');
  });

  it('is "anchor" whenever the song has any anchors', () => {
    expect(
      determineSyncLevel({
        anchors,
        resolvedVoices: [{ userId: 'u1', sha256s: ['a'] }, { userId: 'u2', sha256s: ['b'] }],
        online: true,
      }),
    ).toBe('anchor');
  });

  it('is "page" with no anchors but every resolved voice sharing the identical file(s)', () => {
    expect(
      determineSyncLevel({
        anchors: [],
        resolvedVoices: [{ userId: 'u1', sha256s: ['a'] }, { userId: 'u2', sha256s: ['a'] }],
        online: true,
      }),
    ).toBe('page');
  });

  it('is "song" with no anchors and voices that differ', () => {
    expect(
      determineSyncLevel({
        anchors: [],
        resolvedVoices: [{ userId: 'u1', sha256s: ['a'] }, { userId: 'u2', sha256s: ['b'] }],
        online: true,
      }),
    ).toBe('song');
  });

  it('is "song" when a chordpro voice (empty sha256s) is present alongside a files voice', () => {
    expect(
      determineSyncLevel({
        anchors: [],
        resolvedVoices: [{ userId: 'u1', sha256s: ['a'] }, { userId: 'u2', sha256s: [] }],
        online: true,
      }),
    ).toBe('song');
  });

  it('is "song" with no resolved voices at all', () => {
    expect(determineSyncLevel({ anchors: [], resolvedVoices: [], online: true })).toBe('song');
  });
});
