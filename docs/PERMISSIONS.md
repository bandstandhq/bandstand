# Permissions

Bandstand has exactly three band roles: `owner`, `admin`, `member`. A band always has exactly one
owner.

| Action | owner | admin | member |
|---|:--:|:--:|:--:|
| Rename the band | ✅ | ✅ | — |
| Delete the band | ✅ | — | — |
| Transfer ownership | ✅ | — | — |
| Change a member's role | ✅ | — | — |
| Remove a member | ✅ | ✅ ¹ | — |
| Leave the band | ✅ ² | ✅ | ✅ |
| Create or revoke an invite | ✅ | ✅ | — |
| Create or edit a song | ✅ | ✅ | ✅ |
| Archive or restore a song | ✅ | ✅ | ✅ |
| Permanently delete a song | ✅ | ✅ | — |
| Vote on an idea | ✅ | ✅ | ✅ |
| Resolve a tied idea vote | ✅ | ✅ | — |
| Create or edit a setlist | ✅ | ✅ | ✅ |
| Delete a setlist | ✅ | ✅ | — |
| Manage your own instruments, notes, and personal transpose | ✅ | ✅ | ✅ |
| Upload a file to a voice | ✅ | ✅ | ✅ |
| Detach a file from a voice | ✅ | ✅ | — |
| Change your own voice assignment | ✅ | ✅ | ✅ |
| Change another member's voice assignment | ✅ | ✅ | — |
| Edit a song's anchor list | ✅ | ✅ | — |

¹ An admin can remove a member, but never the owner or another admin.
² The owner can only leave after transferring ownership to someone else.

## Enforcement

This table is not just documentation — it's a rendering of
[`packages/core/src/permissions/matrix.ts`](../packages/core/src/permissions/matrix.ts)'s `can(role,
action)` and `canRemoveMember(actorRole, targetRole)`, the one place this matrix exists in code.
`apps/server` calls these functions to authorize REST requests; `apps/web` calls the same functions
to decide what to render. Neither re-encodes the matrix independently.

Two further points that don't fit a table:

- **Normal editing never needs a role check.** Creating/editing songs and setlists, archiving,
  restoring, and voting are open to every member and happen directly against the shared Yjs
  document (see [ADR-0002](adr/0002-crdt-over-rest.md)) — there's nothing to distinguish by role.
- **Destructive actions on that same document go through REST, not the client's own CRDT write.**
  Permanently deleting a song and deleting a setlist are applied server-side via a direct
  connection to the live document, and an unauthorized attempt to make the same change directly
  (a manipulated client writing straight to the document) is detected and reverted server-side, not
  merely hidden in the UI. See [ADR-0005](adr/0005-permissions.md) for exactly how, and for the one
  action (resolving a tied vote) where this distinction doesn't apply, because the underlying
  mutation is already open to every member through the ordinary archive/restore path.
