// SPDX-License-Identifier: Apache-2.0
import { createApiClient } from '@bandstand/api-client';
import { getDefaultServerUrl } from './auth-client';

export const apiClient = createApiClient(getDefaultServerUrl());
