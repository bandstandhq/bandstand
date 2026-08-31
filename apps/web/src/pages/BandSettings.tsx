// SPDX-License-Identifier: Apache-2.0
import type { MyBand } from '@bandstand/api-client';
import type { BandMember, BandRole, Invite } from '@bandstand/core';
import { can, canRemoveMember, COMMON_INSTRUMENTS, getInviteStatus } from '@bandstand/core';
import { Button, Input } from '@bandstand/ui';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { RequireBandRole } from '../components/RequireBandRole';
import { TrashIcon } from '../components/icons';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';

export function BandSettings() {
  const { bandId } = useParams<{ bandId: string }>();
  if (!bandId) return null;

  return (
    <RequireBandRole bandId={bandId} role="member" fallback={<BandAccessDenied />}>
      <BandSettingsContent bandId={bandId} />
    </RequireBandRole>
  );
}

function BandSettingsContent({ bandId }: { bandId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user.id;
  const [myBand, setMyBand] = useState<MyBand | null>(null);
  const [members, setMembers] = useState<BandMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [bandName, setBandName] = useState('');
  const [renameSaved, setRenameSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function refreshMembers() {
    const [freshMembers, myBands] = await Promise.all([
      apiClient.listBandMembers(bandId),
      apiClient.listMyBands(),
    ]);
    setMembers(freshMembers);
    setMyBand(myBands.find((b) => b.id === bandId) ?? null);
  }

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

  const canRename = myBand ? can(myBand.role, 'band:rename') : false;
  const canManageInvites = myBand ? can(myBand.role, 'invite:create') : false;
  const canDelete = myBand ? can(myBand.role, 'band:delete') : false;

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    const updated = await apiClient.renameBand(bandId, { name: bandName });
    setMyBand((prev) => (prev ? { ...prev, name: updated.name } : prev));
    setRenameSaved(true);
    setTimeout(() => setRenameSaved(false), 2000);
  }

  async function handleDelete() {
    if (!myBand) return;
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
    <PageShell title={myBand?.name}>
      <Link to="/dashboard" className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
        &larr; {t('bandSettings.back')}
      </Link>

      <div className="mt-4">
        {canRename ? (
          <form onSubmit={handleRename} className="flex flex-wrap items-center gap-2">
            <Input
              id="band-name"
              aria-label={t('bandSettings.bandNameLabel')}
              value={bandName}
              onChange={(e) => setBandName(e.target.value)}
              className="w-full max-w-sm text-xl font-medium sm:w-auto"
            />
            <Button type="submit" size="sm">
              {t('bandSettings.rename.save')}
            </Button>
            {renameSaved && (
              <span className="text-sm text-muted-foreground">
                {t('bandSettings.rename.saved')}
              </span>
            )}
          </form>
        ) : (
          <h1 className="text-xl font-medium">{myBand?.name}</h1>
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-medium">{t('bandSettings.members.title')}</h2>
        {myBand && currentUserId && (
          <MemberList
            bandId={bandId}
            members={members}
            viewerRole={myBand.role}
            viewerUserId={currentUserId}
            onRefresh={refreshMembers}
            onLeftBand={() => navigate('/dashboard')}
          />
        )}
      </section>

      {canManageInvites && (
        <section className="mt-8">
          <h2 className="text-lg font-medium">{t('bandSettings.invites.title')}</h2>
          <CreateInviteForm
            bandId={bandId}
            onCreated={(invite) => setInvites((prev) => [invite, ...prev])}
          />
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
          <p className="mt-1 text-sm text-muted-foreground">
            {t('bandSettings.danger.description')}
          </p>
          <Button
            variant="destructive"
            size="sm"
            className="mt-3"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? t('bandSettings.danger.deleting') : t('bandSettings.danger.delete')}
          </Button>
          {deleteError && <p className="mt-2 text-sm text-destructive">{deleteError}</p>}
        </section>
      )}
    </PageShell>
  );
}

function RoleBadge({ role }: { role: BandRole }) {
  const { t } = useTranslation();
  const label =
    role === 'owner'
      ? t('bandSettings.members.roleOwner')
      : role === 'admin'
        ? t('bandSettings.members.roleAdmin')
        : t('bandSettings.members.roleMember');
  const colorClass =
    role === 'owner'
      ? 'bg-primary text-primary-foreground'
      : role === 'admin'
        ? 'bg-accent'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

function MemberList({
  bandId,
  members,
  viewerRole,
  viewerUserId,
  onRefresh,
  onLeftBand,
}: {
  bandId: string;
  members: BandMember[];
  viewerRole: BandRole;
  viewerUserId: string;
  onRefresh: () => Promise<void>;
  onLeftBand: () => void;
}) {
  const { t } = useTranslation();
  // Renders either the table or its narrow-screen card equivalent, never
  // both — a CSS-only `hidden sm:table` / `sm:hidden` pair would put every
  // member's name into the DOM twice, breaking any test (or screen reader)
  // that looks a member up by name without also picking which variant it
  // means.
  const isNarrowScreen = useMediaQuery('(max-width: 639px)');

  if (isNarrowScreen) {
    return (
      <ul className="mt-2 space-y-3">
        {members.map((member) => (
          <MemberCard
            key={member.userId}
            bandId={bandId}
            member={member}
            isSelf={member.userId === viewerUserId}
            viewerRole={viewerRole}
            onRefresh={onRefresh}
            onLeftBand={onLeftBand}
          />
        ))}
      </ul>
    );
  }

  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 pr-4">{t('bandSettings.members.name')}</th>
          <th className="py-1 pr-4">{t('bandSettings.members.email')}</th>
          <th className="py-1 pr-4">{t('bandSettings.members.role')}</th>
          <th className="py-1 pr-4">{t('bandSettings.members.instruments')}</th>
          <th className="py-1" />
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <MemberRow
            key={member.userId}
            bandId={bandId}
            member={member}
            isSelf={member.userId === viewerUserId}
            viewerRole={viewerRole}
            onRefresh={onRefresh}
            onLeftBand={onLeftBand}
          />
        ))}
      </tbody>
    </table>
  );
}

function useMemberActions({
  bandId,
  member,
  isSelf,
  viewerRole,
  onRefresh,
  onLeftBand,
}: {
  bandId: string;
  member: BandMember;
  isSelf: boolean;
  viewerRole: BandRole;
  onRefresh: () => Promise<void>;
  onLeftBand: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleChangeRole(role: 'admin' | 'member') {
    void run(() => apiClient.changeMemberRole(bandId, member.userId, { role }));
  }

  function handleRemove() {
    if (!window.confirm(t('bandSettings.members.confirmRemove', { name: member.name }))) return;
    void run(() => apiClient.removeMember(bandId, member.userId));
  }

  function handleTransfer() {
    if (!window.confirm(t('bandSettings.members.confirmTransfer', { name: member.name }))) return;
    void run(() => apiClient.transferOwnership(bandId, member.userId));
  }

  async function handleLeave() {
    if (!window.confirm(t('bandSettings.members.confirmLeave'))) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.leaveBand(bandId);
      onLeftBand();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const canChangeRole = !isSelf && member.role !== 'owner' && can(viewerRole, 'member:changeRole');
  const canRemove = !isSelf && canRemoveMember(viewerRole, member.role);
  const canTransfer =
    !isSelf && member.role !== 'owner' && can(viewerRole, 'band:transferOwnership');
  const canLeave = isSelf && viewerRole !== 'owner' && can(viewerRole, 'band:leave');

  return {
    busy,
    error,
    canChangeRole,
    canRemove,
    canTransfer,
    canLeave,
    handleChangeRole,
    handleRemove,
    handleTransfer,
    handleLeave,
  };
}

function MemberActionButtons({
  member,
  busy,
  canChangeRole,
  canRemove,
  canTransfer,
  canLeave,
  handleChangeRole,
  handleRemove,
  handleTransfer,
  handleLeave,
  isSelf,
  viewerRole,
}: {
  member: BandMember;
  busy: boolean;
  canChangeRole: boolean;
  canRemove: boolean;
  canTransfer: boolean;
  canLeave: boolean;
  handleChangeRole: (role: 'admin' | 'member') => void;
  handleRemove: () => void;
  handleTransfer: () => void;
  handleLeave: () => void;
  isSelf: boolean;
  viewerRole: BandRole;
}) {
  const { t } = useTranslation();
  return (
    <>
      {canChangeRole && (
        <button
          type="button"
          disabled={busy}
          onClick={() => handleChangeRole(member.role === 'admin' ? 'member' : 'admin')}
          className="text-primary hover:underline"
        >
          {member.role === 'admin'
            ? t('bandSettings.members.makeMember')
            : t('bandSettings.members.makeAdmin')}
        </button>
      )}
      {canTransfer && (
        <button
          type="button"
          disabled={busy}
          onClick={handleTransfer}
          className="text-primary hover:underline"
        >
          {t('bandSettings.members.transferOwnership')}
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          disabled={busy}
          onClick={handleRemove}
          className="text-destructive hover:underline"
        >
          {t('bandSettings.members.remove')}
        </button>
      )}
      {canLeave && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleLeave()}
          className="text-destructive hover:underline"
        >
          {t('bandSettings.members.leave')}
        </button>
      )}
      {isSelf && viewerRole === 'owner' && (
        <span className="text-xs text-muted-foreground">
          {t('bandSettings.members.ownerMustTransfer')}
        </span>
      )}
    </>
  );
}

function MemberCard({
  bandId,
  member,
  isSelf,
  viewerRole,
  onRefresh,
  onLeftBand,
}: {
  bandId: string;
  member: BandMember;
  isSelf: boolean;
  viewerRole: BandRole;
  onRefresh: () => Promise<void>;
  onLeftBand: () => void;
}) {
  const { t } = useTranslation();
  const actions = useMemberActions({ bandId, member, isSelf, viewerRole, onRefresh, onLeftBand });

  return (
    <li className="rounded-md border border-border p-3">
      <p className="wrap-break-word font-medium">{member.name}</p>
      <p className="wrap-break-word text-sm text-muted-foreground">{member.email}</p>
      <div className="mt-1">
        <RoleBadge role={member.role} />
      </div>
      <div className="mt-2 text-sm">
        <span className="text-xs text-muted-foreground">
          {t('bandSettings.members.instruments')}:{' '}
        </span>
        {isSelf ? (
          <InstrumentEditor
            bandId={bandId}
            instruments={member.instruments}
            onChanged={onRefresh}
          />
        ) : (
          member.instruments.join(', ')
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <MemberActionButtons member={member} isSelf={isSelf} viewerRole={viewerRole} {...actions} />
      </div>
      {actions.error && <p className="mt-1 text-xs text-destructive">{actions.error}</p>}
    </li>
  );
}

function MemberRow({
  bandId,
  member,
  isSelf,
  viewerRole,
  onRefresh,
  onLeftBand,
}: {
  bandId: string;
  member: BandMember;
  isSelf: boolean;
  viewerRole: BandRole;
  onRefresh: () => Promise<void>;
  onLeftBand: () => void;
}) {
  const actions = useMemberActions({ bandId, member, isSelf, viewerRole, onRefresh, onLeftBand });

  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="py-1 pr-4 wrap-break-word">{member.name}</td>
        <td className="py-1 pr-4 wrap-break-word">{member.email}</td>
        <td className="py-1 pr-4">
          <RoleBadge role={member.role} />
        </td>
        <td className="py-1 pr-4">
          {isSelf ? (
            <InstrumentEditor
              bandId={bandId}
              instruments={member.instruments}
              onChanged={onRefresh}
            />
          ) : (
            member.instruments.join(', ')
          )}
        </td>
        <td className="py-1">
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
            <MemberActionButtons
              member={member}
              isSelf={isSelf}
              viewerRole={viewerRole}
              {...actions}
            />
          </div>
        </td>
      </tr>
      {actions.error && (
        <tr>
          <td colSpan={5} className="pb-2 text-xs text-destructive">
            {actions.error}
          </td>
        </tr>
      )}
    </>
  );
}

function InstrumentEditor({
  bandId,
  instruments,
  onChanged,
}: {
  bandId: string;
  instruments: string[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [customInstrument, setCustomInstrument] = useState('');
  const [saving, setSaving] = useState(false);
  const availableToAdd = COMMON_INSTRUMENTS.filter((i) => !instruments.includes(i));

  async function save(next: string[]) {
    setSaving(true);
    try {
      await apiClient.updateMyInstruments(bandId, { instruments: next });
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  function addInstrument(name: string) {
    const trimmed = name.trim();
    if (!trimmed || instruments.includes(trimmed)) return;
    void save([...instruments, trimmed]);
  }

  function removeInstrument(name: string) {
    void save(instruments.filter((i) => i !== name));
  }

  return (
    <div className="space-y-1">
      {instruments.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {instruments.map((instrument) => (
            <span
              key={instrument}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs"
            >
              {instrument}
              <button
                type="button"
                onClick={() => removeInstrument(instrument)}
                aria-label={t('bandSettings.members.removeInstrument', { instrument })}
                disabled={saving}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {availableToAdd.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) addInstrument(e.target.value);
            }}
            aria-label={t('bandSettings.members.addInstrument')}
            disabled={saving}
            className="h-7 rounded-md border border-border bg-background px-1 text-xs"
          >
            <option value="">{t('bandSettings.members.addInstrument')}</option>
            {availableToAdd.map((instrument) => (
              <option key={instrument} value={instrument}>
                {instrument}
              </option>
            ))}
          </select>
        )}
        <Input
          value={customInstrument}
          onChange={(e) => setCustomInstrument(e.target.value)}
          placeholder={t('bandSettings.members.customInstrumentPlaceholder')}
          className="h-7 w-28 text-xs"
          disabled={saving}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || !customInstrument.trim()}
          onClick={() => {
            addInstrument(customInstrument);
            setCustomInstrument('');
          }}
        >
          {t('bandSettings.members.addCustomInstrument')}
        </Button>
      </div>
    </div>
  );
}

function CreateInviteForm({
  bandId,
  onCreated,
}: {
  bandId: string;
  onCreated: (invite: Invite) => void;
}) {
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
    <form
      onSubmit={handleSubmit}
      className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border p-4"
    >
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground" htmlFor="invite-label">
          {t('bandSettings.invites.noteLabel')}
        </label>
        <Input
          id="invite-label"
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('bandSettings.invites.notePlaceholder')}
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
        inputMode="numeric"
        min={1}
        max={365}
        step={1}
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
    return (
      <p className="mt-2 text-sm text-muted-foreground">{t('bandSettings.invites.noInvites')}</p>
    );
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
  const { t, i18n } = useTranslation();
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

  const expiryDate = new Date(invite.expiresAt).toLocaleDateString(i18n.language);

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center">
      {qrDataUrl && <img src={qrDataUrl} alt="" width={64} height={64} className="shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="wrap-break-word font-medium">
          {invite.label}
          {invite.instrument ? ` (${invite.instrument})` : ''}
        </p>
        <p className="wrap-break-word font-mono text-sm">{invite.code}</p>
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
          <button
            type="button"
            onClick={handleRevoke}
            disabled={revoking}
            aria-label={t('bandSettings.invites.revoke')}
            title={t('bandSettings.invites.revoke')}
            className="flex h-11 w-11 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        </div>
      )}
    </li>
  );
}
