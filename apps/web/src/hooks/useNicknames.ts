// SPDX-License-Identifier: Apache-2.0
//
// A nickname is strictly private to the viewer who set it (stored in
// Postgres, never synced to the band doc — see
// apps/server/src/routes/nicknames.ts) and replaces the given member's real
// name everywhere it's shown: member list, availability, follow-mode. Every
// screen that renders a member list uses this instead of `member.name`
// directly, so a nickname doesn't need to be wired into each one separately.
import { useCallback, useEffect, useState } from 'react';
import type { MemberNicknames } from '@bandstand/core';
import { apiClient } from '../lib/api-client';

export function useNicknames(bandId: string | undefined) {
  const [nicknames, setNicknames] = useState<MemberNicknames>({});

  useEffect(() => {
    if (!bandId) return;
    apiClient.listMyNicknames(bandId).then(setNicknames);
  }, [bandId]);

  const refresh = useCallback(async () => {
    if (!bandId) return;
    setNicknames(await apiClient.listMyNicknames(bandId));
  }, [bandId]);

  function displayName(member: { userId: string; name: string }): string {
    return nicknames[member.userId] ?? member.name;
  }

  async function setNickname(targetUserId: string, nickname: string) {
    if (!bandId) return;
    const trimmed = nickname.trim();
    if (!trimmed) {
      await clearNickname(targetUserId);
      return;
    }
    await apiClient.setNickname(bandId, targetUserId, { nickname: trimmed });
    await refresh();
  }

  async function clearNickname(targetUserId: string) {
    if (!bandId) return;
    await apiClient.clearNickname(bandId, targetUserId);
    await refresh();
  }

  return { nicknames, displayName, setNickname, clearNickname };
}
