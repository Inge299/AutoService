import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark, Icon } from "@/components/icons";
import { loginAction } from "@/app/login/actions";

export const metadata: Metadata = { title: "Вход" };

const errors: Record<string, string> = {
  invalid_credentials: "Неверный логин или пароль.",
  not_configured: "Авторизация ещё не настроена на сервере.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
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
          <p className="muted login-subtitle">Используйте учётные данные администратора мастерской.</p>
          {error && <div className="form-error"><Icon name="alert" />{errors[error] ?? "Не удалось войти."}</div>}
          <form action={loginAction} className="login-form">
            <label>Логин<input name="login" autoComplete="username" required maxLength={128} placeholder="admin" /></label>
            <label>Пароль<input name="password" type="password" autoComplete="current-password" required maxLength={256} placeholder="••••••••" /></label>
            <button type="submit" className="button button-primary">Войти <Icon name="arrow-right" /></button>
          </form>
          <p className="security-note">Сессия хранится в зашифрованной HttpOnly cookie. Служебные идентификаторы недоступны клиентскому JavaScript и не вводятся пользователем.</p>
        </div>
      </section>
    </main>
  );
}
