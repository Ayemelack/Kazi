import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppLockProvider, useAppLock, type AppLockContextValue } from '../src/applock/AppLockContext';
import { configureSecret, verifySecret } from '../src/applock/storage';
import { HASH_ITERATIONS, hashSecret } from '../src/applock/hash';
import * as hashModule from '../src/applock/hash';

let lock: AppLockContextValue | null = null;

function Probe(): null {
  lock = useAppLock();
  return null;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(async () => {
  jest.restoreAllMocks();
  lock = null;
  await configureSecret({ method: 'pin', secretKind: 'pin', secret: '1234' });
});

describe('app-lock secret comparison', () => {
  it('verifies the stored secret through the constant-time helper', () => {
    const spy = jest.spyOn(hashModule, 'constantTimeEqual');
    const config = {
      enabled: true,
      method: 'pin' as const,
      secretKind: 'pin' as const,
      salt: 'salt',
      hash: hashSecret('1234', 'salt', HASH_ITERATIONS),
      failedAttempts: 0,
      lockoutUntil: 0,
    };

    expect(verifySecret(config, '1234')).toBe(true);
    expect(verifySecret(config, '0000')).toBe(false);
    expect(spy).toHaveBeenCalledWith(hashSecret('1234', 'salt', HASH_ITERATIONS), config.hash);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('unlocks through the constant-time helper and still rejects a wrong secret', async () => {
    const spy = jest.spyOn(hashModule, 'constantTimeEqual');

    await act(async () => {
      ReactTestRenderer.create(
        <AppLockProvider>
          <Probe />
        </AppLockProvider>,
      );
    });
    await flush();

    expect(lock?.ready).toBe(true);

    let wrong: string | undefined;
    await act(async () => {
      wrong = await lock!.unlockWithSecret('0000');
    });
    expect(wrong).toBe('invalid');

    let right: string | undefined;
    await act(async () => {
      right = await lock!.unlockWithSecret('1234');
    });
    expect(right).toBe('ok');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(expect.any(String), expect.any(String));
  });
});
