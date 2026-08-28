// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { getVapidConfig, hasVapidKeys } from './config';

describe('push/config', () => {
  const originalPublic = process.env.VAPID_PUBLIC_KEY;
  const originalPrivate = process.env.VAPID_PRIVATE_KEY;

  afterEach(() => {
    if (originalPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = originalPublic;
    if (originalPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = originalPrivate;
  });

  it('is disabled when neither key is set', () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect(hasVapidKeys()).toBe(false);
  });

  it('is disabled when only one key is set', () => {
    process.env.VAPID_PUBLIC_KEY = 'a-public-key';
    delete process.env.VAPID_PRIVATE_KEY;
    expect(hasVapidKeys()).toBe(false);
  });

  it('is enabled once both keys are set, and getVapidConfig reads them back', () => {
    process.env.VAPID_PUBLIC_KEY = 'a-public-key';
    process.env.VAPID_PRIVATE_KEY = 'a-private-key';
    expect(hasVapidKeys()).toBe(true);
    expect(getVapidConfig()).toEqual({
      publicKey: 'a-public-key',
      privateKey: 'a-private-key',
      subject: 'mailto:admin@example.com',
    });
  });

  it('getVapidConfig throws when keys are missing', () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect(() => getVapidConfig()).toThrow();
  });
});
