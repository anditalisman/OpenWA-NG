import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { dashboardAuthApi } from '../services/api';
import { useRecaptcha } from '../hooks/useRecaptcha';
import './Login.css';

// Also the first-time path: a newly provisioned account has no password until its owner requests
// a link here and sets one.
export function ForgotPassword() {
  const { t } = useTranslation();
  const { getToken } = useRecaptcha();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError(t('forgotPassword.emailRequired'));
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const recaptchaToken = await getToken('dashboard_forgot_password');
      await dashboardAuthApi.forgotPassword({ email: email.trim(), recaptchaToken });
      // Same result whether or not the address has an account — the backend never reveals it.
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
            <h2 style={{ marginBottom: '0.5rem' }}>{t('forgotPassword.submittedTitle')}</h2>
            <p style={{ color: 'var(--text-muted)' }}>{t('forgotPassword.submittedBody', { email })}</p>
          </div>
        ) : (
          <>
            <h2 style={{ marginBottom: '0.5rem' }}>{t('forgotPassword.title')}</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{t('forgotPassword.subtitle')}</p>

            <form onSubmit={e => void handleSubmit(e)} className="login-form">
              <div className="input-group">
                <label htmlFor="email">{t('login.email')}</label>
                <div className="input-wrapper">
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder')}
                    className={error ? 'error' : ''}
                  />
                </div>
                {error && <span className="error-message">{error}</span>}
              </div>

              <button type="submit" className="connect-btn" disabled={isLoading}>
                {isLoading ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
              </button>
            </form>
          </>
        )}

        <p className="login-help">
          <Link to="/">{t('forgotPassword.backToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}
