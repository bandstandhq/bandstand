# ADR-0014: A row that's both a drag handle and a link needs two separate defenses, not one

## Context

`setlist-drag-drop.spec.ts` (the acceptance test dragging a song into a setlist and reordering an
existing item) flaked at roughly 30% under ordinary load and up to ~97% under real CPU contention —
investigated per an explicit instruction to find the actual mechanism rather than paper over it with
a retry or a fixed sleep. `SortableSetlistItem` in `SetlistDetail.tsx` uses the whole row — a React
Router `<Link>` to that item's Stage Mode page — as both the tap target and the dnd-kit drag handle
(`{...attributes} {...listeners}` spread directly on the `<Link>`). Two independent bugs live in
that combination, both load-sensitive, both only possible because the handle is a real, natively
interactive `<a>` rather than a plain `<div>`/`<span>`:

**1. Native browser drag racing dnd-kit's own recognition.** An `<a>` is draggable by default.
dnd-kit's `MouseSensor`/`TouchSensor` do their own synthetic, pointer-event-based drag tracking and
separately try to suppress the browser's native HTML5 drag-and-drop via
`window.addEventListener('dragstart', preventDefault)`, attached synchronously at drag-start. Under
CPU contention this suppression can lose the race: instrumenting the real native `dragstart`/`drag`/
`dragend` events showed `dragstart` firing under light load with the native session still
successfully suppressed every time, but under deliberately-induced CPU load (`Emulation.
setCPUThrottlingRate`, see below) a real native drag session actually started and ran to completion
(`drag` and `dragend` firing) in the majority of runs — the browser's own drag-and-drop taking over
the gesture instead of dnd-kit.

**2. dnd-kit's own click guard doesn't call `preventDefault()`.** Once a drag activates, dnd-kit
adds a `document`-level, capture-phase `click` listener that calls `stopPropagation()` — meant to
eat the click that a mousedown→mousemove→mouseup cycle would otherwise fire on the handle once the
gesture ends. `stopPropagation()` only stops the event from reaching further listeners (including
React's own delegated handling, which is how React Router's `<Link>` would normally call its own
`preventDefault()` before deciding whether to navigate client-side); it does nothing to the
browser's native default action for a real anchor. Since React Router's handler is the one thing
that would have called `preventDefault()`, and dnd-kit's guard prevents it from ever running, the
browser proceeds with its own default action — a full navigation to the link's `href` — regardless
of whether the click was "supposed to" count as part of a drag. Confirmed directly: an `onClick`
placed on the `<Link>` never fired at all in a failing run, yet the page still navigated (verified
via `page.on('framenavigated')` and a real `beforeunload`), which is only possible if the browser's
own default action ran unopposed. On top of that, dnd-kit removes its own guard on a hardcoded
50ms `setTimeout` regardless of whether the click has actually arrived by then, so under load the
guard can also simply be gone before the (already load-delayed) click fires — a second, independent
way to reach the same result.

Neither bug is a test artifact: the production target for Stage Mode is real, sometimes older,
tablet hardware on stage, not just a busy CI runner — CPU contention there is a realistic operating
condition, not a corner case worth dismissing.

## Decision

**Fix 1 — `draggable={false}` on the `<Link>`.** Removes the browser's native drag mechanism from
this element entirely, so there's no longer a second, competing drag implementation to race against
dnd-kit's own. This is necessary but, on its own, insufficient — it does nothing about the click
guard gap above, which reproduced 100% of the time under load even with this fix alone in place.

**Fix 2 — an app-level click guard that actually calls `preventDefault()`, registered where it will
run before dnd-kit's.** Each `SortableSetlistItem` keeps a `suppressNextClickRef`, armed via
`useDndMonitor`'s `onDragStart` only when `event.active.id` matches that row's own item (so it never
suppresses a click on a row that wasn't the one dragged), and cleared the moment a fresh gesture
starts on that row (`onPointerDown`) or once it's actually used. The listener that checks it and
calls `preventDefault()` is attached to `document` in the capture phase, once, in a `useEffect` at
mount — not per-drag, and not on the link element itself. Both details matter: capture-phase
listeners run top-down by DOM position, so a listener on the link would still run *after* one on
`document` regardless of when either was registered (document is reached first descending toward
any of its descendants); to run before dnd-kit's own per-drag `document` listener, this has to also
be on `document`, and among multiple listeners on the same node in the same phase, order is
attachment order — so registering once at mount (long before any drag can start) guarantees this
one is always first. The suppression window is exactly one click, with no timer involved: armed by
a real recognized drag-start for this exact item, consumed and cleared by the next click or the next
pointerdown, whichever comes first — never by a deadline. `apps/web/e2e-acceptance/
setlist-drag-drop.spec.ts` has a dedicated regression test for this lifecycle: a real, plain click on
a row immediately after dragging it must still navigate normally, proving the suppression covers
exactly one click and nothing more.

Both fixes stay, even though fix 2 is the one that actually moves the failure rate — fix 1 addresses
a separately-confirmed, real mechanism (native drag winning outright under load) that fix 2 does not
touch.

**Where else this applies:** any row that's simultaneously a full-row navigable element and a
dnd-kit drag handle has the same exposure. `SongAnchors.tsx` and `PdfVoiceViewer.tsx` already use a
separate, non-interactive drag-handle element (a dedicated grip span/div) rather than making an
interactive row double as the handle, so neither needed either fix — audited and confirmed as part
of this change. `SetlistDetail.tsx`'s `SortableSetlistItem` was the only site in the codebase where
the handle and a real `<a>`/navigable element were the same node. See `CONTRIBUTING.md` for the
rule going forward.

## Testing under realistic load, not just ambient load

An acceptance test that only ever runs on a quiet machine would not have caught either bug — both
are load-sensitive, and the flake rate tracked host CPU load, not code changes, throughout much of
this investigation (verified by a clean A/B: reverting every test-side change back to the exact
committed baseline and re-running at elevated ambient load reproduced the same failure rate as the
"broken" instrumented version, isolating load, not the instrumentation, as the variable). Ambient
load isn't reproducible or CI-portable, so the test instead throttles the page's own main thread
directly via CDP: `page.context().newCDPSession(page)` +
`Emulation.setCPUThrottlingRate({ rate: 6 })`, applied only around the drag interactions (not
login/setup, so it can't blow the test timeout on unrelated steps) and reset to `1` in a `finally`.
This is deterministic and portable — it doesn't depend on the host machine having spare cores or
being quiet — and Chromium-only, which matches `playwright.acceptance.config.ts`'s single
`chromium` project. At `rate: 6`, the original (pre-fix) code fails reliably (30/30 in calibration);
with both fixes applied, the same test passes reliably at the same throttle rate.

The test also keeps a permanent, low-overhead regression guard: it listens for the real native
`drag`/`dragend` events (not `dragstart`, which fires on mere attempt and says nothing about who
won the race) and asserts neither ever fires. If `draggable={false}` is ever removed or bypassed,
this fails immediately under the same throttled run rather than waiting for someone to notice a
flake again.
