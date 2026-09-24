import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Languages } from 'lucide-react';
import { CustomSelect } from '../components/CustomSelect';
import { languageOptions, resolveSupportedLanguage, type SupportedLanguage } from '../i18n';
import { dashboardAuthApi } from '../services/api';
import { useRecaptcha } from '../hooks/useRecaptcha';
import './Login.css';

interface LoginProps {
  onLogin: (apiKey: string, role?: string) => void;
}

// Sign-in is email + password only. The server answers with a short-lived key minted for this login,
// which the rest of the dashboard sends as X-API-Key exactly like before; a plain API key cannot be
// entered here (and one left in storage is logged out at startup, see resolveStartupValidation).
export function Login({ onLogin }: LoginProps) {
  const { t, i18n } = useTranslation();
  const { getToken } = useRecaptcha();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const currentLang = resolveSupportedLanguage(i18n.resolvedLanguage || i18n.language);

  const changeLanguage = (language: SupportedLanguage) => {
    void i18n.changeLanguage(language);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError(t('login.credentialsRequired'));
      return;
    }
    setIsLoading(true);
    setError('');

    try {
      const recaptchaToken = await getToken('dashboard_login');
      const result = await dashboardAuthApi.login({ email: email.trim(), password, recaptchaToken });
      onLogin(result.apiKey, result.role);
    } catch (err) {
      setError(err instanceof TypeError ? t('login.connectionError') : (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <img src="/pamgm_logo.png" alt="OpenWA PAMGM" className="logo-icon" />
          <span className="version-info">
            {t('login.version', {
              version: __APP_VERSION__,
              // ISO date (YYYYMMDD) so the format is stable across locales/regions instead of the
              // locale-dependent toLocaleDateString() which renders differently per browser region.
              date: new Date(__BUILD_TIME__).toISOString().slice(0, 10).replace(/-/g, ''),
            })}
          </span>
        </div>

        <div className="login-language">
          <Languages size={18} />
          <CustomSelect
            value={currentLang}
            onChange={value => changeLanguage(value as SupportedLanguage)}
            options={languageOptions.map(opt => ({ value: opt.value, label: opt.label }))}
            ariaLabel={t('common.language')}
          />
        </div>

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
          </div>

          <div className="input-group">
            <label htmlFor="password">{t('login.password')}</label>
            <div className="input-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('login.passwordPlaceholder')}
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
            {error && <span className="error-message">{error}</span>}
          </div>

          <button type="submit" className="connect-btn" disabled={isLoading}>
            {isLoading ? t('login.signingIn') : t('login.signIn')}
          </button>
        </form>

        <p className="login-help">
          <Link to="/forgot-password">{t('login.forgotPassword')}</Link>
        </p>
      </div>
    </div>
  );
}
