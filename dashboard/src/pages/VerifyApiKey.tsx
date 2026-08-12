import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Copy, KeyRound, Loader2, TriangleAlert } from 'lucide-react';
import { selfServiceApi } from '../services/api';
import { copyToClipboard } from '../utils/clipboard';
import './Login.css';

type Status = 'verifying' | 'success' | 'error';

export function VerifyApiKey() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [status, setStatus] = useState<Status>('verifying');
  const [issuedKey, setIssuedKey] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);
  // The token is single-use server-side, so a second real request for the same token always fails
  // ("already used") even though the first one succeeded. Without this guard, React 18/19
  // StrictMode's dev-only double-invoke of effects would fire the request twice, silently
  // discarding the key from the first (real, successful) call and showing the user an error from
  // the second. A ref survives that synthetic remount, so it dedupes per token without needing to
  // touch the effect's dependency array.
  const startedForToken = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage(t('verifyApiKey.missingToken'));
      return;
    }
    if (startedForToken.current === token) return;
    startedForToken.current = token;

    selfServiceApi
      .verify(token)
      .then(result => {
        setIssuedKey(result.apiKey);
        setStatus('success');
      })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof Error ? err.message : t('login.connectionError'));
        setStatus('error');
      });
    // Deliberately runs once per token (guarded above) — this consumes a single-use link, so it
    // must not re-fire on an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleCopy = async () => {
    if (await copyToClipboard(issuedKey)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <img src="/pamgm_logo.png" alt="OpenWA PAMGM" className="logo-icon" />
        </div>

        {status === 'verifying' && (
          <div>
            <Loader2 className="animate-spin" size={32} style={{ marginBottom: '1rem' }} />
            <p style={{ color: 'var(--text-muted)' }}>{t('verifyApiKey.verifying')}</p>
          </div>
        )}

        {status === 'success' && (
          <div>
            <KeyRound size={40} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
            <h2 style={{ marginBottom: '0.5rem' }}>{t('verifyApiKey.successTitle')}</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{t('verifyApiKey.successBody')}</p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', textAlign: 'left' }}>
              <code
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: 'var(--bg-secondary)',
                  borderRadius: '6px',
                  wordBreak: 'break-all',
                }}
              >
                {issuedKey}
              </code>
              <button className="btn-primary" onClick={() => void handleCopy()} aria-label={t('common.copy')}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div>
            <TriangleAlert size={40} style={{ color: 'var(--error)', marginBottom: '1rem' }} />
            <h2 style={{ marginBottom: '0.5rem' }}>{t('verifyApiKey.errorTitle')}</h2>
            <p style={{ color: 'var(--text-muted)' }}>{errorMessage}</p>
          </div>
        )}

        <p className="login-help">
          <Link to="/">{t('requestApiKey.backToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}
