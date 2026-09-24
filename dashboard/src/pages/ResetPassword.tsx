import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { dashboardAuthApi } from '../services/api';
import './Login.css';

// Mirrors PASSWORD_MIN_LENGTH on the server (src/modules/auth/dashboard-password.ts), which is what
// actually enforces it; checking here only saves a round-trip.
const PASSWORD_MIN_LENGTH = 10;

export function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(t('resetPassword.tooShort', { min: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t('resetPassword.mismatch'));
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await dashboardAuthApi.resetPassword({ token, password });
      setDone(true);
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

        {!token ? (
          <p className="error-message">{t('resetPassword.missingToken')}</p>
        ) : done ? (
          <div>
            <CheckCircle2 size={40} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
            <h2 style={{ marginBottom: '0.5rem' }}>{t('resetPassword.doneTitle')}</h2>
            <p style={{ color: 'var(--text-muted)' }}>{t('resetPassword.doneBody')}</p>
          </div>
        ) : (
          <>
            <h2 style={{ marginBottom: '0.5rem' }}>{t('resetPassword.title')}</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              {t('resetPassword.subtitle', { min: PASSWORD_MIN_LENGTH })}
            </p>

            <form onSubmit={e => void handleSubmit(e)} className="login-form">
              <div className="input-group">
                <label htmlFor="password">{t('resetPassword.newPassword')}</label>
                <div className="input-wrapper">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className={error ? 'error' : ''}
                  />
                  <button
                    type="button"
                    className="toggle-visibility"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="confirm">{t('resetPassword.confirmPassword')}</label>
                <div className="input-wrapper">
                  <input
                    id="confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className={error ? 'error' : ''}
                  />
                </div>
                {error && <span className="error-message">{error}</span>}
              </div>

              <button type="submit" className="connect-btn" disabled={isLoading}>
                {isLoading ? t('resetPassword.submitting') : t('resetPassword.submit')}
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
