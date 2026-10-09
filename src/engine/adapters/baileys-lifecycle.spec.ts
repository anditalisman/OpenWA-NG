jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));
jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  initAuthCreds: jest.fn(),
  makeCacheableSignalKeyStore: jest.fn((keys: unknown) => keys),
}));
jest.mock('./baileys-auth-store', () => ({
  useAtomicMultiFileAuthState: jest.fn().mockRejectedValue(new Error('stop after auth load')),
}));

import * as BaileysLib from '@whiskeysockets/baileys';
import { useAtomicMultiFileAuthState } from './baileys-auth-store';
import { BaileysLifecycle, type BaileysLifecycleHost } from './baileys-lifecycle';
import type { BaileysVersionResolver, ResolveOptions } from './baileys-version-resolver';

describe('BaileysLifecycle.connect', () => {
  it('loads the auth state through the atomic store with the session auth dir, library and logger', async () => {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const noCallback = (): undefined => undefined;
    const host = {
      authPath: '/data/baileys/session-sess-1',
      logger,
      config: { sessionId: 'sess-1' },
      getOnStateChanged: noCallback,
      getOnError: noCallback,
    } as unknown as BaileysLifecycleHost;

    await expect(new BaileysLifecycle(host).initialize()).rejects.toThrow('stop after auth load');

    expect(useAtomicMultiFileAuthState).toHaveBeenCalledTimes(1);
    const [folder, lib, authLogger] = jest.mocked(useAtomicMultiFileAuthState).mock.calls[0];
    expect(folder).toBe(host.authPath);
    expect(lib.initAuthCreds).toBe(BaileysLib.initAuthCreds);
    expect(authLogger).toBe(logger);
  });
});

describe('BaileysLifecycle teardown while connecting', () => {
  const settle = () => new Promise(resolve => setImmediate(resolve));
  function connecting() {
    const noCallback = (): undefined => undefined;
    const host = {
      authPath: '/nonexistent/openwa-lifecycle-spec/session-sess-1',
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      config: {
        sessionId: 'sess-1',
        dbSessionId: 'db-1',
        proxyUrl: 'http://user:pass@proxy.example:8080',
        messageStore: { clearSession: jest.fn().mockResolvedValue(undefined) },
      },
      liveCalls: new Map(),
      fenceStoredWrites: jest.fn(),
      getOnStateChanged: noCallback,
      getOnDisconnected: noCallback,
      getOnError: noCallback,
      getOnCredentialTeardownStarted: noCallback,
    } as unknown as BaileysLifecycleHost;
    const engine = new BaileysLifecycle(host);
    engine.sock = null;
    type AuthState = Awaited<ReturnType<typeof useAtomicMultiFileAuthState>>;
    let releaseAuth: ((value: AuthState) => void) | undefined;
    jest.mocked(useAtomicMultiFileAuthState).mockImplementationOnce(
      () =>
        new Promise<AuthState>(resolve => {
          releaseAuth = resolve;
        }),
    );
    const resolver = (engine as unknown as { versionResolver: BaileysVersionResolver }).versionResolver;
    const resolve = jest.spyOn(resolver, 'resolve');
    const authRequested = async () => {
      while (!releaseAuth) await settle();
    };
    const loadAuth = () =>
      releaseAuth?.({ state: { creds: {}, keys: {} }, saveCreds: jest.fn() } as unknown as AuthState);
    return { engine, resolve, authRequested, loadAuth };
  }

  it('skips the version lookup when the session stops while its auth state loads', async () => {
    const { engine, resolve, authRequested, loadAuth } = connecting();
    const init = engine.initialize();
    await authRequested();
    await engine.disconnect();
    loadAuth();
    await init;

    expect(resolve).not.toHaveBeenCalled();
    expect(engine.sock).toBeNull();
  });

  it('aborts the version lookup when the session stops during it', async () => {
    const { engine, resolve, authRequested, loadAuth } = connecting();
    let signal: AbortSignal | undefined;
    let finish: ((version: [number, number, number]) => void) | undefined;
    resolve.mockImplementationOnce(
      (_lib, options?: ResolveOptions) =>
        new Promise(done => {
          signal = options?.signal;
          finish = done;
        }),
    );
    const init = engine.initialize();
    await authRequested();
    loadAuth();
    while (!finish) await settle();
    expect(signal?.aborted).toBe(false);

    await engine.destroy();

    expect(signal?.aborted).toBe(true);
    finish([2, 3000, 1]);
    await init;
    expect(engine.sock).toBeNull();
  });
});
