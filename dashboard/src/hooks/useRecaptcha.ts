import { useCallback, useEffect, useRef, useState } from 'react';
import { selfServiceApi } from '../services/api';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

const RECAPTCHA_SCRIPT_SRC = 'https://www.google.com/recaptcha/api.js';

// Module-scoped so the script tag is only ever injected once, even if multiple pages mount the
// hook across a session (RequestApiKey and ForgotApiKey both use it).
let scriptLoadPromise: Promise<void> | null = null;

function loadRecaptchaScript(siteKey: string): Promise<void> {
  if (!scriptLoadPromise) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${RECAPTCHA_SCRIPT_SRC}?render=${encodeURIComponent(siteKey)}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load reCAPTCHA'));
      document.head.appendChild(script);
    });
  }
  return scriptLoadPromise;
}

/**
 * Google reCAPTCHA v3 for the self-service "request/forgot key" forms. Fetches whether the backend
 * has RECAPTCHA_ENABLED=true and, if so, loads the widget script and exposes getToken(action) to
 * mint a fresh per-submission token. When disabled — or if anything here fails — getToken() simply
 * resolves undefined and the form submits without a token, which the backend accepts identically
 * (RecaptchaService.assertHuman no-ops unless it independently has RECAPTCHA_ENABLED=true, so
 * disabling client-side never weakens server-side enforcement).
 */
export function useRecaptcha() {
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    selfServiceApi
      .getRecaptchaConfig()
      .then(config => {
        if (!mountedRef.current || !config.enabled || !config.siteKey) return;
        setSiteKey(config.siteKey);
        return loadRecaptchaScript(config.siteKey).then(() => {
          if (mountedRef.current) setScriptReady(true);
        });
      })
      .catch(() => {
        // Fails open client-side — see getToken() below.
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const getToken = useCallback(
    (action: string): Promise<string | undefined> => {
      if (!siteKey || !scriptReady || !window.grecaptcha) return Promise.resolve(undefined);
      return new Promise<string | undefined>(resolve => {
        window.grecaptcha!.ready(() => {
          window
            .grecaptcha!.execute(siteKey, { action })
            .then(resolve)
            .catch(() => resolve(undefined));
        });
      });
    },
    [siteKey, scriptReady],
  );

  return { getToken };
}
