import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { selfServiceApi } from '../services/api';
import './Login.css';

export function ForgotApiKey() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError(t('forgotApiKey.fieldsRequired'));
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await selfServiceApi.requestRecovery({ name: name.trim(), email: email.trim() });
      // Always show the same "check your email" result, whether or not the domain is actually
      // allow-listed / a matching key exists — the backend deliberately never reveals that, so the
      // UI can't either. Same posture as RequestApiKey.
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
            <h2 style={{ marginBottom: '0.5rem' }}>{t('forgotApiKey.submittedTitle')}</h2>
            <p style={{ color: 'var(--text-muted)' }}>{t('forgotApiKey.submittedBody', { email })}</p>
          </div>
        ) : (
          <>
            <h2 style={{ marginBottom: '0.5rem' }}>{t('forgotApiKey.title')}</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{t('forgotApiKey.subtitle')}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              {t('forgotApiKey.corporateEmailHint')}
            </p>

            <form onSubmit={e => void handleSubmit(e)} className="login-form">
              <div className="input-group">
                <label htmlFor="name">{t('forgotApiKey.nameLabel')}</label>
                <div className="input-wrapper">
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('forgotApiKey.namePlaceholder')}
                    className={error ? 'error' : ''}
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="email">{t('forgotApiKey.emailLabel')}</label>
                <div className="input-wrapper">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={t('forgotApiKey.emailPlaceholder')}
                    className={error ? 'error' : ''}
                  />
                </div>
                {error && <span className="error-message">{error}</span>}
              </div>

              <button type="submit" className="connect-btn" disabled={isLoading}>
                {isLoading ? t('forgotApiKey.submitting') : t('forgotApiKey.submit')}
              </button>
            </form>
          </>
        )}

        <p className="login-help">
          <Link to="/request-api-key">{t('forgotApiKey.requestNewInstead')}</Link>
        </p>
        <p className="login-help">
          <Link to="/">{t('requestApiKey.backToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}
