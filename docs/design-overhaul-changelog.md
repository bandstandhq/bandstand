# Design overhaul — foundation changelog

Pure design/component adoption of shadcn/ui's real conventions (Sky color, Nova
style, Medium radius, Inter font, Lucide icons), replacing hand-rolled UI with
real shadcn/ui components wherever a counterpart exists. No new features — a
component/visual swap only. This is the foundation; the two navigation-layout
variants (sidebar, bottom-nav) are separate follow-up work, not part of this
changelog.

Stages 1–2 landed as independent PRs (pure token/asset swaps, isolated risk).
Stages 3–8 landed as a sequence of commits on `feat/design-forms`.

## Stage 1 — Theme tokens + font (PR #210)

- Added the shadcn token set this app was missing: `--secondary`,
  `--muted`/`-foreground`, `--popover`/`-foreground`, `--input`,
  `--accent-foreground`, `--radius` (and derived `--radius-sm/md/lg/xl`).
- Retuned the accent hue to shadcn's "Sky" (was a purple-leaning 250°),
  adjusted contrast/lightness toward "Nova"'s tighter feel.
- **Flipped the dark/light CSS convention** to shadcn's standard: bare `:root`
  is now light, `.dark` is the override class (was the reverse).
- Self-hosted Inter via `@fontsource/inter` — no Google Fonts CDN call, in
  keeping with this project's self-hosting posture.
- Files: `packages/ui/src/styles.css`, `theme.css`,
  `apps/web/src/components/GlobalPrefsEffects.tsx`, `index.css`.

## Stage 2 — Icons → Lucide (PR #211)

- Every hand-drawn inline SVG icon (15 distinct glyphs, ~30 call sites across
  `packages/ui` and `apps/web`) replaced with a direct `lucide-react` import.
  Both `icons.tsx` files deleted entirely.
- Fixed a real nav-menu-consistency regression the acceptance suite caught
  during this pass (unrelated to icons themselves — an earlier nav
  restructuring had broken the test's landmark assertion).

## Stage 3 — Select (PR #212)

- All 20 native `<select>` elements → real shadcn/ui `Select`
  (`packages/ui/src/components/Select.tsx`, Radix-based): `BandSwitcher`,
  `AccountSettings`' language picker, song key/status, event type/status/
  repeat, poll close options, band invite role, PDF anchor calibration, voice
  assignment, and more.
- Updated 13 e2e-acceptance call sites across 6 spec files from Playwright's
  `.selectOption()` (native-only) to open-then-click, via a new shared
  `selectComboboxOption` fixture helper.

## Stage 4 — DropdownMenu (PR #213)

- The one confirmed "click a button, get a floating action list" pattern in
  the app (Repertoire's export toggle) → real shadcn/ui `DropdownMenu`.
- Confirmed scope boundary: no other consolidated action-menu pattern exists
  elsewhere (AppHeader's menu is a full navigation `Sheet`; per-row actions
  are separate inline icon buttons) — not a gap, a deliberate exclusion.

## Stage 5 — Dialog (PR #214)

- `Dialog.tsx` moved from a bespoke fixed-prop API (`title`/`description`/
  `closeLabel` props) to shadcn's real composable shape (`Dialog`,
  `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`,
  `DialogDescription`, `DialogFooter`, `DialogClose`).
- Updated all 8 page-level call sites plus `ConfirmDialog.tsx` (its own
  public API — `confirm()`/`chooseAction()`/`notify()` — unchanged, only the
  internals moved).
- Kept this app's own considered behavior: mobile-full-screen /
  `sm:`-breakpoint-to-centered layout, and the required `closeLabel` (the
  visible X is the only way out on a phone with no Escape key).

## Stage 6 — Tabs (PR #225)

- `PdfVoiceViewer`'s single/spread/scroll mode switch → shadcn/ui `Tabs`,
  the app's one genuine co-equal-views switch (Repertoire's active/archived
  toggle stays a single toggle, per its own existing design).

## Stage 7 — Calendar (PR #226)

- The hand-rolled month grid in `Calendar.tsx` → shadcn/ui's `Calendar`
  wrapper (`packages/ui/src/components/Calendar.tsx`) around
  `react-day-picker` v10. Per-day event content stays page-specific via
  `components.Day`.
- Fixed a real UTC-vs-local timezone bug during the port: react-day-picker
  generates days in local time, while this app's event-occurrence buckets
  are UTC-anchored — day-cell lookups now re-derive a UTC key from each
  cell's local Y/M/D components.
- Folded in a follow-up request: all 8 native date/datetime-local inputs
  across `Calendar.tsx`, `EventDetail.tsx`, `PollDetail.tsx` now use the
  shared `Input` component.

## Stage 8 — Forms (react-hook-form + shadcn `Form`)

New `packages/ui/src/components/Form.tsx` (`Form`/`FormField`/`FormItem`/
`FormLabel`/`FormControl`/`FormMessage`, built on react-hook-form's
`Controller`) and `Label.tsx`. All 20 forms in the app migrated off
hand-rolled `useState`-per-field:

| Form | File | Notes |
|---|---|---|
| ChangeNameForm | `components/ChangeNameForm.tsx` | |
| ChangeEmailForm | `components/ChangeEmailForm.tsx` | `requestEmailChangeInputSchema` resolver |
| ChangePasswordForm | `components/ChangePasswordForm.tsx` | mismatch check → zod `.refine()` |
| CreateBandForm | `components/CreateBandForm.tsx` | `createBandInputSchema` resolver |
| JoinBandForm | `components/JoinBandForm.tsx` | deliberately non-empty-only client check |
| SignupForm | `components/SignupForm.tsx` | |
| Login | `pages/Login.tsx` | |
| ForgotPassword | `pages/ForgotPassword.tsx` | |
| ResetPassword | `pages/ResetPassword.tsx` | gained a confirm-password field (was inconsistent with ChangePasswordForm) |
| BandSettings rename form | `pages/BandSettings.tsx` | `renameBandInputSchema` — first real validation this field ever had |
| NicknameEditor | `pages/BandSettings.tsx` | |
| CreateInviteForm | `pages/BandSettings.tsx` | |
| CreateEventForm | `pages/Calendar.tsx` | `saveRef`/`isDirty` pattern preserved for the page-level unsaved-changes guard |
| CreatePollForm | `pages/Calendar.tsx` | dynamic options → real `useFieldArray` |
| EditPollForm | `pages/PollDetail.tsx` | dynamic options → `useFieldArray` |
| EditEventForm | `pages/EventDetail.tsx` | `allDay` cross-field re-derivation preserved |
| ChangeRecurrenceForm | `pages/EventDetail.tsx` | |
| create-setlist form | `pages/SetlistList.tsx` | |
| SongEditor | `pages/SongEditor.tsx` | most involved: `setFocus`, tap-tempo second writer, split minute/second field, key-transpose side effect — see commit for detail |
| ServerPicker | `components/ServerPicker.tsx` | new `RadioGroup` component built for its mode picker |

Also: `PasswordInput` became a `forwardRef` component (needed for
`FormControl`'s Radix `Slot`).

**Found along the way, filed rather than fixed** (out of scope for a pure
component migration): issue #233 — transposing a brand-new, unsaved song's
key discards its typed ChordPro body (pre-existing, verified to reproduce on
`main`).

## Verification

Every stage: `pnpm turbo run lint typecheck test build` green. Stages
touching interaction-heavy pages (Select, Dialog, Calendar, Forms) additionally
verified against the real e2e-acceptance suite on a production build + live
server, not just unit tests. Stage 8 closed with a full acceptance-suite run
(86 tests): one genuine regression found and fixed (a spec needed to fill
ResetPassword's new confirm field); the rest were either a rate-limit cascade
from running the full suite back-to-back (confirmed clean in isolation) or
pre-existing flakes (confirmed to reproduce identically on a clean `main`
checkout).

## What was **not** replaced, and why

- **Native `type="date"`/`datetime-local"` inputs elsewhere** (event/poll
  create-and-edit forms) — shadcn has no official date-picker primitive (the
  popover+Calendar pattern is an unofficial recipe); the brief's "Kalender →
  Calendar" was read as the calendar page/grid specifically, not every date
  input in the app.
- **Stage Mode's own settings panels** (sliders, color pickers) — not
  `DropdownMenu` candidates; that primitive is for action lists, not
  free-form controls.
- **Repertoire's active/archived toggle** — stays a single toggle button, not
  `Tabs`; it's a filter, not two co-equal views, per its own existing design
  comment.
- **PollDetail's `CloseSection`** — still a `<div>`, not a `<form>`. A
  `closePollInputSchema` in `@bandstand/core` would fit closely, but
  converting it changes structure beyond a component swap — left as an open
  decision for a future pass, not decided unilaterally mid-migration.
