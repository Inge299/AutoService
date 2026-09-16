import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark, Icon } from "@/components/icons";
import { loginAction, requestStaffCodeAction, verifyStaffCodeAction } from "@/app/login/actions";

export const metadata: Metadata = { title: "Вход" };

const errors: Record<string, string> = {
  invalid_credentials: "Неверный логин или пароль.",
  too_many_attempts: "Слишком много попыток. Подождите 15 минут и попробуйте снова.",
  not_configured: "Авторизация ещё не настроена на сервере.",
  access_revoked: "Доступ к учётной записи отключён администратором.",
  server_unavailable: "Сервер авторизации временно недоступен.",
  invalid_phone: "Проверьте номер телефона.",
  sms_unavailable: "Вход по SMS временно недоступен.",
  invalid_code: "Неверный или просроченный код.",
  session_expired: "Сессия завершена. Войдите снова.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string; challenge?: string }> }) {
  const { error, mode, challenge } = await searchParams;
  return (
    <main className="login-page">
      <section className="login-story">
        <Link href="/" className="login-brand"><BrandMark /></Link>
        <div className="login-message">
          <span className="eyebrow light">Рабочее пространство мастерской</span>
          <h1>Весь ремонт —<br />в понятном процессе.</h1>
          <p>Визиты, доказательства, решения клиентов и повторные обращения в одном спокойном интерфейсе.</p>
        </div>
        <div className="login-proof"><span><Icon name="check" /></span><p><strong>Данные мастерской изолированы</strong><small>Доступ определяется серверной сессией</small></p></div>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <span className="mobile-login-brand"><BrandMark /></span>
          <p className="eyebrow">Добро пожаловать</p>
          <h2>Вход в AutoService</h2>
          <p className="muted login-subtitle">{mode === "code" ? "Введите код из SMS." : mode === "sms" ? "Получите одноразовый код на рабочий номер." : "Войдите по SMS или используйте пароль."}</p>
          {error && <div className="form-error"><Icon name="alert" />{errors[error] ?? "Не удалось войти."}</div>}
          {mode === "code" && challenge ? <form action={verifyStaffCodeAction} className="login-form">
            <input type="hidden" name="challenge" value={challenge} />
            <label>Код из SMS<input name="code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} pattern="[0-9]{6}" placeholder="000000" /></label>
            <button type="submit" className="button button-primary">Подтвердить <Icon name="arrow-right" /></button>
            <Link className="text-link" href="/login?mode=sms">Запросить новый код</Link>
          </form> : mode === "sms" ? <form action={requestStaffCodeAction} className="login-form">
            <label>Телефон<input name="phone" type="tel" autoComplete="tel" required maxLength={32} placeholder="+7 999 123-45-67" /></label>
            <button type="submit" className="button button-primary">Получить код <Icon name="arrow-right" /></button>
            <Link className="text-link" href="/login">Войти по паролю</Link>
          </form> : <>
            <form action={loginAction} className="login-form">
              <label>Логин<input name="login" autoComplete="username" required maxLength={128} placeholder="admin" /></label>
              <label>Пароль<input name="password" type="password" autoComplete="current-password" required maxLength={256} placeholder="••••••••" /></label>
              <button type="submit" className="button button-primary">Войти <Icon name="arrow-right" /></button>
            </form>
            <Link className="button button-secondary" href="/login?mode=sms">Войти по SMS</Link>
          </>}
          <p className="security-note">Сессия хранится в зашифрованной HttpOnly cookie. Служебные идентификаторы недоступны клиентскому JavaScript и не вводятся пользователем.</p>
        </div>
      </section>
    </main>
  );
}
