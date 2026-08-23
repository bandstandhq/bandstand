// SPDX-License-Identifier: AGPL-3.0-or-later
import { pgEnum } from 'drizzle-orm/pg-core';

export const bandRoleEnum = pgEnum('band_role', ['owner', 'admin', 'member']);
