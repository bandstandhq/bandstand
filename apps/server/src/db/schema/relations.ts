// SPDX-License-Identifier: AGPL-3.0-or-later
import { relations } from 'drizzle-orm';
import { accounts } from './auth';
import { bandMembers } from './bandMembers';
import { bands } from './bands';
import { bandDocs } from './bandDocs';
import { invites } from './invites';
import { sessions } from './auth';
import { users } from './users';

export const usersRelations = relations(users, ({ many }) => ({
  bandMemberships: many(bandMembers),
  sessions: many(sessions),
  accounts: many(accounts),
}));

export const bandsRelations = relations(bands, ({ one, many }) => ({
  members: many(bandMembers),
  invites: many(invites),
  doc: one(bandDocs, { fields: [bands.id], references: [bandDocs.bandId] }),
}));

export const bandMembersRelations = relations(bandMembers, ({ one }) => ({
  band: one(bands, { fields: [bandMembers.bandId], references: [bands.id] }),
  user: one(users, { fields: [bandMembers.userId], references: [users.id] }),
}));

export const invitesRelations = relations(invites, ({ one }) => ({
  band: one(bands, { fields: [invites.bandId], references: [bands.id] }),
  createdByUser: one(users, { fields: [invites.createdBy], references: [users.id] }),
  redeemedByUser: one(users, { fields: [invites.redeemedBy], references: [users.id] }),
}));
