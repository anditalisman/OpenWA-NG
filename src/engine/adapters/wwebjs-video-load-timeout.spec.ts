import type { Client } from 'whatsapp-web.js';
import { noteVideoLoadTimeout } from './wwebjs-video-load-timeout';
import { type WwebjsEngineHost } from './wwebjs-host';

/**
 * WhatsApp Web loads a video into a `<video>` element before it uploads it and throws a bare
 * `TimeoutError` after 20 s when that load neither finishes nor fails. The gateway cannot tell why
 * from the error, so the failed send also logs what the page answers about the two conditions worth
 * checking first (#1902).
 */

const WARNING = 'WhatsApp Web timed out loading a video. See docs/12-troubleshooting-faq.md.';

/** The probe is not awaited by the send, so let it settle before reading the log. */
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** Run the page function against a stub document, as the page would. */
const pageAnswering =
  (visibility: string, h264Aac: string) =>
  <T>(fn: () => T): Promise<T> => {
    const g = globalThis as unknown as { document?: unknown };
    g.document = { visibilityState: visibility, createElement: () => ({ canPlayType: () => h264Aac }) };
    try {
      return Promise.resolve(fn());
    } finally {
      delete g.document;
    }
  };

function makeHost(evaluate: jest.Mock): { host: WwebjsEngineHost; warn: jest.Mock } {
  const client = {
    pupPage: { evaluate },
    pupBrowser: { version: jest.fn().mockResolvedValue('Chrome/153.0.8010.36') },
  };
  const warn = jest.fn();
  const host = {
    getClient: () => client as unknown as Client,
    logger: { warn, log: jest.fn(), debug: jest.fn(), error: jest.fn() },
    config: { sessionId: 'sess-1' },
  } as unknown as WwebjsEngineHost;
  return { host, warn };
}

const named = (name: string, message: string): Error => Object.assign(new Error(message), { name });

describe('noteVideoLoadTimeout', () => {
  it.each([
    ['named TimeoutError', named('TimeoutError', 'TimeoutError')],
    ['with TimeoutError at the head of its message', new Error('TimeoutError: ')],
  ])('logs what the page answers for a video send that failed %s', async (_how, error) => {
    const { host, warn } = makeHost(jest.fn(pageAnswering('hidden', 'probably')));

    noteVideoLoadTimeout(host, error, 'video/mp4');
    await flush();

    expect(warn).toHaveBeenCalledWith(WARNING, {
      sessionId: 'sess-1',
      action: 'video_load_timeout',
      pageVisibility: 'hidden',
      h264Aac: 'probably',
      browser: 'Chrome/153.0.8010.36',
    });
  });

  it('stays quiet for an image, or a video that failed on anything else', async () => {
    const evaluate = jest.fn(pageAnswering('visible', ''));
    const { host, warn } = makeHost(evaluate);

    noteVideoLoadTimeout(host, named('TimeoutError', 'TimeoutError'), 'image/jpeg');
    noteVideoLoadTimeout(host, new Error('Evaluation failed: Error: upload refused'), 'video/mp4');
    noteVideoLoadTimeout(host, named('TimeoutError', 'TimeoutError'), undefined as unknown as string);
    await flush();

    expect(evaluate).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs nothing and never throws when the page cannot answer', async () => {
    const { host, warn } = makeHost(jest.fn().mockRejectedValue(new Error('Target closed')));

    expect(() => noteVideoLoadTimeout(host, named('TimeoutError', 'TimeoutError'), 'video/mp4')).not.toThrow();
    await flush();

    expect(warn).not.toHaveBeenCalled();
  });
});
