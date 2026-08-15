import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { selfServiceApi } from '../services/api';
import { useRecaptcha } from '../hooks/useRecaptcha';
import './Login.css';

export function RequestApiKey() {
  const { t } = useTranslation();
  const { getToken } = useRecaptcha();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError(t('requestApiKey.fieldsRequired'));
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const recaptchaToken = await getToken('self_service_request');
      await selfServiceApi.request({ name: name.trim(), email: email.trim(), recaptchaToken });
      // Always show the same "check your email" result, whether or not the domain is actually
      // allow-listed — the backend deliberately never reveals that, so the UI can't either.
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.connectionError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <img src="/pamgm_logo.png" alt="OpenWA PAMGM" className="logo-icon" />
        </div>

        {submitted ? (
          <div>
            <MailCheck size={40} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
            <h2 style={{ marginBottom: '0.5rem' }}>{t('requestApiKey.submittedTitle')}</h2>
            <p style={{ color: 'var(--text-muted)' }}>{t('requestApiKey.submittedBody', { email })}</p>
          </div>
        ) : (
          <>
            <h2 style={{ marginBottom: '0.5rem' }}>{t('requestApiKey.title')}</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{t('requestApiKey.subtitle')}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              {t('requestApiKey.corporateEmailHint')}
            </p>

            <form onSubmit={e => void handleSubmit(e)} className="login-form">
              <div className="input-group">
                <label htmlFor="name">{t('requestApiKey.nameLabel')}</label>
                <div className="input-wrapper">
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('requestApiKey.namePlaceholder')}
                    className={error ? 'error' : ''}
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="email">{t('requestApiKey.emailLabel')}</label>
                <div className="input-wrapper">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={t('requestApiKey.emailPlaceholder')}
                    className={error ? 'error' : ''}
                  />
                </div>
                {error && <span className="error-message">{error}</span>}
              </div>

              <button type="submit" className="connect-btn" disabled={isLoading}>
                {isLoading ? t('requestApiKey.submitting') : t('requestApiKey.submit')}
              </button>
            </form>
          </>
        )}

        <p className="login-help">
          <Link to="/forgot-api-key">{t('requestApiKey.lostKeyInstead')}</Link>
        </p>
        <p className="login-help">
          <Link to="/">{t('requestApiKey.backToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}
