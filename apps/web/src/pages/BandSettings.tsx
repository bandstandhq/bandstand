// SPDX-License-Identifier: Apache-2.0
import type { MyBand } from '@bandstand/api-client';
import type { BandMember, BandRole, Invite } from '@bandstand/core';
import { can, getInviteStatus } from '@bandstand/core';
import { Button, Input } from '@bandstand/ui';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { apiClient } from '../lib/api-client';

export function BandSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bandId } = useParams<{ bandId: string }>();
  const [myBand, setMyBand] = useState<MyBand | null>(null);
  const [members, setMembers] = useState<BandMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [bandName, setBandName] = useState('');
  const [renameSaved, setRenameSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!bandId) return;
    apiClient.listMyBands().then((bands) => {
      const band = bands.find((b) => b.id === bandId) ?? null;
      setMyBand(band);
      if (band) setBandName(band.name);
    });
    apiClient.listBandMembers(bandId).then(setMembers);
    // A non-admin's request 403s — that's fine, they just see no invites section.
    apiClient
      .listInvites(bandId)
      .then(setInvites)
      .catch(() => setInvites([]));
  }, [bandId]);

  if (!bandId) return null;

  const canRename = myBand ? can(myBand.role, 'band:rename') : false;
  const canManageInvites = myBand ? can(myBand.role, 'invite:create') : false;
  const canDelete = myBand ? can(myBand.role, 'band:delete') : false;

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    if (!bandId) return;
    const updated = await apiClient.renameBand(bandId, { name: bandName });
    setMyBand((prev) => (prev ? { ...prev, name: updated.name } : prev));
    setRenameSaved(true);
    setTimeout(() => setRenameSaved(false), 2000);
  }

  async function handleDelete() {
    if (!bandId || !myBand) return;
    if (!window.confirm(t('bandSettings.danger.confirm', { name: myBand.name }))) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiClient.deleteBand(bandId);
      navigate('/dashboard');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Link to="/dashboard" className="text-sm text-muted-foreground hover:underline">
        &larr; {t('bandSettings.back')}
      </Link>

      <div className="mt-4">
        {canRename ? (
          <form onSubmit={handleRename} className="flex items-center gap-2">
            <Input
              id="band-name"
              aria-label={t('bandSettings.bandNameLabel')}
              value={bandName}
              onChange={(e) => setBandName(e.target.value)}
              className="max-w-sm text-xl font-medium"
            />
            <Button type="submit" size="sm">
              {t('bandSettings.rename.save')}
            </Button>
            {renameSaved && <span className="text-sm text-muted-foreground">{t('bandSettings.rename.saved')}</span>}
          </form>
        ) : (
          <h1 className="text-xl font-medium">{myBand?.name}</h1>
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-medium">{t('bandSettings.members.title')}</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-4">{t('bandSettings.members.name')}</th>
              <th className="py-1 pr-4">{t('bandSettings.members.email')}</th>
              <th className="py-1 pr-4">{t('bandSettings.members.role')}</th>
              <th className="py-1">{t('bandSettings.members.instruments')}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId} className="border-t border-border">
                <td className="py-1 pr-4">{member.name}</td>
                <td className="py-1 pr-4">{member.email}</td>
                <td className="py-1 pr-4">{member.role}</td>
                <td className="py-1">{member.instruments.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {canManageInvites && (
        <section className="mt-8">
          <h2 className="text-lg font-medium">{t('bandSettings.invites.title')}</h2>
          <CreateInviteForm bandId={bandId} onCreated={(invite) => setInvites((prev) => [invite, ...prev])} />
          <InviteList
            bandId={bandId}
            invites={invites}
            members={members}
            onRevoked={(updated) =>
              setInvites((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
            }
          />
        </section>
      )}

      {canDelete && (
        <section className="mt-8 rounded-md border border-destructive p-4">
          <h2 className="text-lg font-medium text-destructive">{t('bandSettings.danger.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('bandSettings.danger.description')}</p>
          <Button variant="destructive" size="sm" className="mt-3" onClick={handleDelete} disabled={deleting}>
            {deleting ? t('bandSettings.danger.deleting') : t('bandSettings.danger.delete')}
          </Button>
          {deleteError && <p className="mt-2 text-sm text-destructive">{deleteError}</p>}
        </section>
      )}
    </main>
  );
}

function CreateInviteForm({ bandId, onCreated }: { bandId: string; onCreated: (invite: Invite) => void }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [instrument, setInstrument] = useState('');
  const [role, setRole] = useState<BandRole>('member');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const invite = await apiClient.createInvite(bandId, {
        label,
        instrument: instrument.trim() || undefined,
        role,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      });
      onCreated(invite);
      setLabel('');
      setInstrument('');
      setExpiresInDays('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border p-4">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground" htmlFor="invite-label">
          {t('bandSettings.invites.createTitle')}
        </label>
        <Input
          id="invite-label"
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('bandSettings.invites.labelPlaceholder')}
          className="w-48"
        />
      </div>
      <Input
        value={instrument}
        onChange={(e) => setInstrument(e.target.value)}
        placeholder={t('bandSettings.invites.instrumentPlaceholder')}
        className="w-52"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as BandRole)}
        aria-label={t('bandSettings.invites.role')}
        className="h-10 rounded-md border border-border bg-background px-3 text-sm"
      >
        <option value="member">{t('bandSettings.invites.roleMember')}</option>
        <option value="admin">{t('bandSettings.invites.roleAdmin')}</option>
      </select>
      <Input
        type="number"
        min={1}
        value={expiresInDays}
        onChange={(e) => setExpiresInDays(e.target.value)}
        placeholder={t('bandSettings.invites.expiresInDays')}
        className="w-40"
      />
      <Button type="submit" disabled={submitting || !label.trim()}>
        {submitting ? t('bandSettings.invites.creating') : t('bandSettings.invites.create')}
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </form>
  );
}

function InviteList({
  bandId,
  invites,
  members,
  onRevoked,
}: {
  bandId: string;
  invites: Invite[];
  members: BandMember[];
  onRevoked: (invite: Invite) => void;
}) {
  const { t } = useTranslation();

  if (invites.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">{t('bandSettings.invites.noInvites')}</p>;
  }

  const redeemerName = (userId: string | null) =>
    userId ? (members.find((m) => m.userId === userId)?.name ?? null) : null;

  return (
    <ul className="mt-4 space-y-3">
      {invites.map((invite) => (
        <InviteRow
          key={invite.id}
          bandId={bandId}
          invite={invite}
          redeemedByName={redeemerName(invite.redeemedBy)}
          onRevoked={onRevoked}
        />
      ))}
    </ul>
  );
}

function InviteRow({
  bandId,
  invite,
  redeemedByName,
  onRevoked,
}: {
  bandId: string;
  invite: Invite;
  redeemedByName: string | null;
  onRevoked: (invite: Invite) => void;
}) {
  const { t } = useTranslation();
  const status = getInviteStatus(invite);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    if (status !== 'open') return;
    const redeemUrl = `${window.location.origin}/join/${invite.code}`;
    QRCode.toDataURL(redeemUrl, { margin: 1, width: 96 }).then(setQrDataUrl);
  }, [status, invite.code]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by browser permission policy —
      // the code is still visible and selectable, so this isn't fatal.
    }
  }

  async function handleRevoke() {
    setRevoking(true);
    try {
      const updated = await apiClient.revokeInvite(bandId, invite.id);
      onRevoked(updated);
    } finally {
      setRevoking(false);
    }
  }

  const expiryDate = new Date(invite.expiresAt).toLocaleDateString();

  return (
    <li className="flex items-center gap-4 rounded-md border border-border p-3">
      {qrDataUrl && <img src={qrDataUrl} alt="" width={64} height={64} />}
      <div className="flex-1">
        <p className="font-medium">
          {invite.label}
          {invite.instrument ? ` (${invite.instrument})` : ''}
        </p>
        <p className="font-mono text-sm">{invite.code}</p>
        <p className="text-xs text-muted-foreground">
          {status === 'open' && t('bandSettings.invites.expires', { date: expiryDate })}
          {status === 'expired' && t('bandSettings.invites.expiredOn', { date: expiryDate })}
          {status === 'redeemed' &&
            (redeemedByName
              ? t('bandSettings.invites.redeemedBy', { name: redeemedByName })
              : t('bandSettings.invites.redeemedByUnknown'))}
          {status === 'revoked' && t('bandSettings.invites.revoked')}
        </p>
      </div>
      {status === 'open' && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? t('bandSettings.invites.copied') : t('bandSettings.invites.copy')}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleRevoke} disabled={revoking}>
            {t('bandSettings.invites.revoke')}
          </Button>
        </div>
      )}
    </li>
  );
}
