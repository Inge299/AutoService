import Link from "next/link";
import { BrandMark, Icon } from "@/components/icons";
import {
  loginCustomerAction,
  requestCustomerLoginCodeAction,
  verifyCustomerLoginCodeAction,
} from "@/app/customer/actions";

export const metadata = { title: "Вход клиента" };

const errors: Record<string, string> = {
  invalid_credentials: "Неверные данные для входа.",
  too_many_attempts: "Слишком много попыток. Подождите немного и повторите запрос.",
  account_exists: "Кабинет уже создан — войдите в него.",
  invalid_phone: "Проверьте номер телефона.",
  invalid_code: "Неверный или просроченный код.",
  sms_unavailable: "Вход по SMS временно недоступен.",
  session_expired: "Сессия завершена. Войдите снова.",
};

function withApproval(path: string, approval?: string): string {
  if (!approval) return path;
  return `${path}${path.includes("?") ? "&" : "?"}approval=${encodeURIComponent(approval)}`;
}

export default async function CustomerLoginPage({ searchParams }: {
  searchParams: Promise<{ approval?: string; error?: string; mode?: string; challenge?: string }>;
}) {
  const { approval, error, mode, challenge } = await searchParams;
  return <main className="login-page">
    <section className="login-story"><Link href="/" className="login-brand"><BrandMark /></Link><div className="login-message"><span className="eyebrow light">Личный кабинет клиента</span><h1>Ваши автомобили.<br />Ваш ремонт.</h1><p>Следите за статусами, согласовывайте работы и храните историю обслуживания в одном месте.</p></div></section>
    <section className="login-panel"><div className="login-form-wrap">
      <p className="eyebrow">Клиентский кабинет</p>
      <h2>{mode === "code" ? "Введите код" : "Войти"}</h2>
      <p className="muted login-subtitle">{mode === "code" ? "Код из SMS действует 5 минут." : mode === "sms" ? "Получите одноразовый код на телефон." : "Войдите по SMS или используйте e-mail и пароль."}</p>
      {error && <div className="form-error"><Icon name="alert" />{errors[error] ?? "Не удалось войти."}</div>}
      {mode === "code" && challenge ? <form action={verifyCustomerLoginCodeAction} className="login-form">
        <input type="hidden" name="approval" value={approval ?? ""} />
        <input type="hidden" name="challenge" value={challenge} />
        <label>Код из SMS<input name="code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} pattern="[0-9]{6}" placeholder="000000" /></label>
        <button className="button button-primary" type="submit">Подтвердить и войти</button>
        <Link className="text-link" href={withApproval("/customer/login?mode=sms", approval)}>Запросить новый код</Link>
      </form> : mode === "sms" ? <form action={requestCustomerLoginCodeAction} className="login-form">
        <input type="hidden" name="approval" value={approval ?? ""} />
        <label>Телефон<input name="phone" type="tel" autoComplete="tel" required maxLength={32} placeholder="+7 999 123-45-67" /></label>
        <button className="button button-primary" type="submit">Получить код</button>
        <Link className="text-link" href={withApproval("/customer/login", approval)}>Войти по паролю</Link>
      </form> : <>
        <form action={loginCustomerAction} className="login-form">
          <input type="hidden" name="approval" value={approval ?? ""} />
          <label>Телефон или e-mail<input name="identity" autoComplete="username" required maxLength={254} /></label>
          <label>Пароль<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
          <button className="button button-primary" type="submit">Войти в кабинет</button>
        </form>
        <Link className="button button-secondary" href={withApproval("/customer/login?mode=sms", approval)}>Войти по SMS</Link>
      </>}
      {approval && <Link className="text-link" href={`/customer/register?approval=${encodeURIComponent(approval)}`}>Создать кабинет по этой ссылке</Link>}
    </div></section>
  </main>;
}
