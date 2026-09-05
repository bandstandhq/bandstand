// SPDX-License-Identifier: Apache-2.0
import { zodResolver } from '@hookform/resolvers/zod';
import type { MyBand } from '@bandstand/api-client';
import type { BandMember, BandRole, Invite } from '@bandstand/core';
import { can, canRemoveMember, COMMON_INSTRUMENTS, getInviteStatus, renameBandInputSchema } from '@bandstand/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useConfirmDialog,
} from '@bandstand/ui';
import { Pencil, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { FullRepertoireExport } from '../components/FullRepertoireExport';
import { RequireBandRole } from '../components/RequireBandRole';
import { useBandDoc } from '../hooks/useBandDoc';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useNicknames } from '../hooks/useNicknames';
import { useTrustedSession } from '../hooks/useTrustedSession';
import { apiClient } from '../lib/api-client';

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
  const { data: session } = useTrustedSession();
  const currentUserId = session?.user.id;
  const [myBand, setMyBand] = useState<MyBand | null>(null);
  const [members, setMembers] = useState<BandMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const renameForm = useForm<{ name: string }>({
    resolver: zodResolver(renameBandInputSchema),
    defaultValues: { name: '' },
  });
  const [renameSaved, setRenameSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const nicknames = useNicknames(bandId);

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
    apiClient
      .listMyBands()
      .then((bands) => {
        const band = bands.find((b) => b.id === bandId) ?? null;
        setMyBand(band);
        if (band) renameForm.reset({ name: band.name });
      })
      // Offline/unreachable — without this, myBand stays null forever and
      // every role-gated section below (rename, invites, danger zone) just
      // silently never appears, with no indication why. Surface it instead.
      .catch(() => setLoadFailed(true));
    apiClient
      .listBandMembers(bandId)
      .then(setMembers)
      .catch(() => setLoadFailed(true));
    // A non-admin's request 403s — that's fine, they just see no invites section.
    apiClient
      .listInvites(bandId)
      .then(setInvites)
      .catch(() => setInvites([]));
    // `renameForm` is stable (react-hook-form guarantees the returned
    // object's identity across renders) — omitted deliberately, not missed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandId]);

  const canRename = myBand ? can(myBand.role, 'band:rename') : false;
  const canManageInvites = myBand ? can(myBand.role, 'invite:create') : false;
  const canDelete = myBand ? can(myBand.role, 'band:delete') : false;
  const canExportRepertoire = myBand ? can(myBand.role, 'repertoire:export') : false;
  // Only connected when actually needed — every other section here is
  // plain REST, and the full export is the one feature that needs the live
  // Yjs doc (see FullRepertoireExport.tsx).
  const { doc } = useBandDoc(canExportRepertoire ? bandId : null);

  async function handleRename(values: { name: string }) {
    const updated = await apiClient.renameBand(bandId, values);
    setMyBand((prev) => (prev ? { ...prev, name: updated.name } : prev));
    setRenameSaved(true);
    setTimeout(() => setRenameSaved(false), 2000);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiClient.deleteBand(bandId);
      setDeleteDialogOpen(false);
      navigate('/dashboard');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <PageShell title={myBand?.name}>
      {/* Hidden on mobile: BottomNav's own Dashboard tab already covers this there. */}
      <Link to="/dashboard" className="mt-4 hidden text-sm text-muted-foreground hover:underline sm:inline-block">
        &larr; {t('bandSettings.back')}
      </Link>

      {loadFailed && (
        <p className="mt-4 rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
          {t('bandSettings.offlineNotice')}
        </p>
      )}

      <div className="mt-4">
        {canRename ? (
          <Form {...renameForm}>
            <form onSubmit={renameForm.handleSubmit(handleRename)} className="flex flex-wrap items-center gap-2">
              <FormField
                control={renameForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="contents">
                    <FormControl>
                      <Input
                        aria-label={t('bandSettings.bandNameLabel')}
                        className="w-full max-w-sm text-xl font-medium sm:w-auto"
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
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
          </Form>
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
            nicknames={nicknames}
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

      {canExportRepertoire && (
        <section className="mt-8 rounded-md border border-border p-4">
          <h2 className="text-lg font-medium">{t('bandSettings.export.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('bandSettings.export.description')}</p>
          <div className="mt-3">{doc && <FullRepertoireExport bandId={bandId} doc={doc} />}</div>
        </section>
      )}

      {canDelete && myBand && (
        <section className="mt-8 rounded-md border border-destructive p-4">
          <h2 className="text-lg font-medium text-destructive">{t('bandSettings.danger.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('bandSettings.danger.description')}
          </p>
          <Button
            variant="destructive"
            size="sm"
            className="mt-3"
            onClick={() => setDeleteDialogOpen(true)}
          >
            {t('bandSettings.danger.delete')}
          </Button>
          {deleteError && <p className="mt-2 text-sm text-destructive">{deleteError}</p>}
          <DeleteBandDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            bandName={myBand.name}
            deleting={deleting}
            onConfirm={handleDelete}
          />
        </section>
      )}
    </PageShell>
  );
}

function DeleteBandDialog({
  open,
  onOpenChange,
  bandName,
  deleting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bandName: string;
  deleting: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [typedName, setTypedName] = useState('');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setTypedName('');
      }}
    >
      <DialogContent closeLabel={t('bandSettings.danger.cancel')}>
        <DialogHeader>
          <DialogTitle>{t('bandSettings.danger.dialogTitle', { name: bandName })}</DialogTitle>
          <DialogDescription>{t('bandSettings.danger.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder={t('bandSettings.danger.typeNamePlaceholder')}
          aria-label={t('bandSettings.danger.typeNamePlaceholder')}
        />
        <Button
          variant="destructive"
          className="w-full"
          disabled={typedName !== bandName || deleting}
          onClick={onConfirm}
        >
          {deleting ? t('bandSettings.danger.deleting') : t('bandSettings.danger.confirmTyped')}
        </Button>
      </DialogContent>
    </Dialog>
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
  nicknames,
  onRefresh,
  onLeftBand,
}: {
  bandId: string;
  members: BandMember[];
  viewerRole: BandRole;
  viewerUserId: string;
  nicknames: ReturnType<typeof useNicknames>;
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
            nicknames={nicknames}
            onRefresh={onRefresh}
            onLeftBand={onLeftBand}
          />
        ))}
      </ul>
    );
  }

  return (
    // Scrolls within its own row rather than forcing the whole page wider —
    // needed now that the sidebar leaves less width for content at exactly
    // the viewports (640–1023px) where this table, not the narrow-screen
    // card list above, is what renders (see mobile-usability.spec.ts).
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-sm">
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
              nicknames={nicknames}
              onRefresh={onRefresh}
              onLeftBand={onLeftBand}
            />
          ))}
        </tbody>
      </table>
    </div>
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
  const { confirm } = useConfirmDialog();
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

  async function handleRemove() {
    const confirmed = await confirm({
      title: t('bandSettings.members.confirmRemove', { name: member.name }),
      confirmLabel: t('bandSettings.members.remove'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;
    void run(() => apiClient.removeMember(bandId, member.userId));
  }

  async function handleTransfer() {
    const confirmed = await confirm({
      title: t('bandSettings.members.confirmTransfer', { name: member.name }),
      confirmLabel: t('bandSettings.members.transferOwnership'),
      cancelLabel: t('common.cancel'),
      variant: 'default',
    });
    if (!confirmed) return;
    void run(() => apiClient.transferOwnership(bandId, member.userId));
  }

  async function handleLeave() {
    if (viewerRole === 'owner') {
      // Ownership transfers automatically to whoever ranks highest among
      // the rest of the band — the owner needs to see who that is *before*
      // committing to leave, not find out after (see docs/adr/0005-
      // permissions.md). The DELETE call below re-derives the same
      // successor itself rather than trusting this preview, so a
      // membership change between the two requests can't desync them.
      setBusy(true);
      setError(null);
      let successor: Awaited<ReturnType<typeof apiClient.previewOwnershipSuccessor>>['successor'];
      try {
        ({ successor } = await apiClient.previewOwnershipSuccessor(bandId));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
        return;
      }
      setBusy(false);
      if (!successor) {
        setError(t('bandSettings.members.soleOwnerCannotLeave'));
        return;
      }
      const confirmedAsOwner = await confirm({
        title: t('bandSettings.members.confirmLeaveAsOwner', { name: successor.name }),
        confirmLabel: t('bandSettings.members.leave'),
        cancelLabel: t('common.cancel'),
      });
      if (!confirmedAsOwner) return;
    } else {
      const confirmedLeave = await confirm({
        title: t('bandSettings.members.confirmLeave'),
        confirmLabel: t('bandSettings.members.leave'),
        cancelLabel: t('common.cancel'),
      });
      if (!confirmedLeave) return;
    }

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
  const canLeave = isSelf && can(viewerRole, 'band:leave');

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
          onClick={() => void handleTransfer()}
          className="text-primary hover:underline"
        >
          {t('bandSettings.members.transferOwnership')}
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleRemove()}
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
    </>
  );
}

/** Toggles between the display name (nickname if set, else the real name) and an inline editor. */
function NicknameEditor({
  member,
  nicknames,
}: {
  member: BandMember;
  nicknames: ReturnType<typeof useNicknames>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const hasNickname = Object.hasOwn(nicknames.nicknames, member.userId);
  const form = useForm<{ value: string }>({ defaultValues: { value: '' } });

  if (editing) {
    return (
      <Form {...form}>
        <form
          className="flex flex-wrap items-center gap-1"
          onSubmit={form.handleSubmit(async ({ value }) => {
            await nicknames.setNickname(member.userId, value);
            setEditing(false);
          })}
        >
          <FormField
            control={form.control}
            name="value"
            render={({ field }) => (
              <FormItem className="contents">
                <FormControl>
                  <Input
                    autoFocus
                    placeholder={t('bandSettings.members.nicknamePlaceholder')}
                    className="h-7 w-32 text-sm"
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <Button type="submit" size="sm">
            {t('bandSettings.members.saveNickname')}
          </Button>
          <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setEditing(false)}>
            {t('bandSettings.members.cancelNickname')}
          </button>
        </form>
      </Form>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {hasNickname && <span className="text-xs text-muted-foreground">{t('bandSettings.members.realName', { name: member.name })}</span>}
      <button
        type="button"
        aria-label={t('bandSettings.members.editNickname', { name: member.name })}
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          form.reset({ value: nicknames.nicknames[member.userId] ?? '' });
          setEditing(true);
        }}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
      {hasNickname && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:underline"
          onClick={() => void nicknames.clearNickname(member.userId)}
        >
          {t('bandSettings.members.clearNickname')}
        </button>
      )}
    </span>
  );
}

function MemberCard({
  bandId,
  member,
  isSelf,
  viewerRole,
  nicknames,
  onRefresh,
  onLeftBand,
}: {
  bandId: string;
  member: BandMember;
  isSelf: boolean;
  viewerRole: BandRole;
  nicknames: ReturnType<typeof useNicknames>;
  onRefresh: () => Promise<void>;
  onLeftBand: () => void;
}) {
  const { t } = useTranslation();
  const actions = useMemberActions({ bandId, member, isSelf, viewerRole, onRefresh, onLeftBand });

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="wrap-break-word font-medium">{nicknames.displayName(member)}</p>
        {!isSelf && <NicknameEditor member={member} nicknames={nicknames} />}
      </div>
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
        <MemberActionButtons member={member} {...actions} />
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
  nicknames,
  onRefresh,
  onLeftBand,
}: {
  bandId: string;
  member: BandMember;
  isSelf: boolean;
  viewerRole: BandRole;
  nicknames: ReturnType<typeof useNicknames>;
  onRefresh: () => Promise<void>;
  onLeftBand: () => void;
}) {
  const actions = useMemberActions({ bandId, member, isSelf, viewerRole, onRefresh, onLeftBand });

  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="py-1 pr-4 wrap-break-word">
          <div className="flex flex-wrap items-center gap-2">
            <span>{nicknames.displayName(member)}</span>
            {!isSelf && <NicknameEditor member={member} nicknames={nicknames} />}
          </div>
        </td>
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
            <MemberActionButtons member={member} {...actions} />
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
          // key resets Radix's internal (uncontrolled) selection back to
          // unset after every pick — this is a one-shot "add" action, not a
          // persistent filter, so the trigger must show the placeholder
          // again immediately rather than lingering on the just-added
          // instrument (which the shrunk availableToAdd list wouldn't even
          // contain as a valid item anymore).
          <Select key={availableToAdd.join(',')} onValueChange={(value) => addInstrument(value)}>
            <SelectTrigger aria-label={t('bandSettings.members.addInstrument')} disabled={saving} className="h-7 text-xs">
              <SelectValue placeholder={t('bandSettings.members.addInstrument')} />
            </SelectTrigger>
            <SelectContent>
              {availableToAdd.map((instrument) => (
                <SelectItem key={instrument} value={instrument}>
                  {instrument}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
  const [role, setRole] = useState<BandRole>('member');
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ label: string; instrument: string; expiresInDays: string }>({
    defaultValues: { label: '', instrument: '', expiresInDays: '' },
  });
  const labelValue = useWatch({ control: form.control, name: 'label' });

  async function onSubmit(values: { label: string; instrument: string; expiresInDays: string }) {
    setError(null);
    try {
      const invite = await apiClient.createInvite(bandId, {
        label: values.label,
        instrument: values.instrument.trim() || undefined,
        role,
        expiresInDays: values.expiresInDays ? Number(values.expiresInDays) : undefined,
      });
      onCreated(invite);
      form.reset({ label: '', instrument: '', expiresInDays: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border p-4"
      >
        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs font-normal text-muted-foreground">
                {t('bandSettings.invites.noteLabel')}
              </FormLabel>
              <FormControl>
                <Input required placeholder={t('bandSettings.invites.notePlaceholder')} className="w-48" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="instrument"
          render={({ field }) => (
            <FormItem className="contents">
              <FormControl>
                <Input placeholder={t('bandSettings.invites.instrumentPlaceholder')} className="w-52" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <Select value={role} onValueChange={(value) => setRole(value as BandRole)}>
          <SelectTrigger aria-label={t('bandSettings.invites.role')} className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">{t('bandSettings.invites.roleMember')}</SelectItem>
            <SelectItem value="admin">{t('bandSettings.invites.roleAdmin')}</SelectItem>
          </SelectContent>
        </Select>
        <FormField
          control={form.control}
          name="expiresInDays"
          render={({ field }) => (
            <FormItem className="contents">
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  step={1}
                  placeholder={t('bandSettings.invites.expiresInDays')}
                  className="w-40"
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting || !labelValue.trim()}>
          {form.formState.isSubmitting ? t('bandSettings.invites.creating') : t('bandSettings.invites.create')}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </form>
    </Form>
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
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
  );
}
