import { ActionLink, Button } from "@/components/action";
import Link from "next/link";
import { BrandMark, Icon } from "@/components/icons";
import {
  loginCustomerAction,
  requestCustomerLoginCodeAction,
  verifyCustomerLoginCallAction,
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
  call_pending: "Звонок ещё не подтверждён. Позвоните с указанного номера и проверьте снова.",
  session_expired: "Сессия завершена. Войдите снова.",
};

function withApproval(path: string, approval?: string): string {
  if (!approval) return path;
  return `${path}${path.includes("?") ? "&" : "?"}approval=${encodeURIComponent(approval)}`;
}

export default async function CustomerLoginPage({ searchParams }: {
  searchParams: Promise<{ approval?: string; error?: string; mode?: string; challenge?: string; callPhone?: string; callPhonePretty?: string }>;
}) {
  const { approval, error, mode, challenge, callPhone, callPhonePretty } = await searchParams;
  const activeMode = mode ?? (approval ? undefined : "sms");
  const dialPhone = callPhone?.replace(/[^\d+]/g, "");
  return <main className="login-page">
    <section className="login-story"><Link href="/" className="login-brand"><BrandMark /></Link><div className="login-message"><span className="eyebrow light">Личный кабинет клиента</span><h1>Ваши автомобили.<br />Ваш ремонт.</h1><p>Следите за статусами, согласовывайте работы и храните историю обслуживания в одном месте.</p></div></section>
    <section className="login-panel"><div className="login-form-wrap">
      <p className="eyebrow">Клиентский кабинет</p>
      <h2>{activeMode === "call" ? "Позвоните для входа" : activeMode === "code" ? "Введите код" : "Войти в кабинет"}</h2>
      <p className="muted login-subtitle">{activeMode === "call" ? "Позвоните с указанного номера — звонок будет сброшен автоматически." : activeMode === "code" ? "Код из SMS действует 5 минут." : activeMode === "sms" ? "Укажите номер — подтвердите вход звонком." : "Войдите с телефоном или e-mail и паролем."}</p>
      {error && <div className="form-error"><Icon name="alert" />{errors[error] ?? "Не удалось войти."}</div>}
      {activeMode === "call" && challenge && dialPhone ? <form action={verifyCustomerLoginCallAction} className="login-form">
        <input type="hidden" name="approval" value={approval ?? ""} />
        <input type="hidden" name="challenge" value={challenge} />
        <input type="hidden" name="callPhone" value={dialPhone} />
        <input type="hidden" name="callPhonePretty" value={callPhonePretty ?? dialPhone} />
        <ActionLink variant="secondary"  href={`tel:${dialPhone}`}>{callPhonePretty ?? dialPhone}</ActionLink>
        <Button variant="primary" className="" type="submit">Я позвонил — проверить</Button>
        <ActionLink variant="secondary"  href={withApproval("/customer/login?mode=sms", approval)}>Указать другой номер</ActionLink>
      </form> : activeMode === "code" && challenge ? <form action={verifyCustomerLoginCodeAction} className="login-form">
        <input type="hidden" name="approval" value={approval ?? ""} />
        <input type="hidden" name="challenge" value={challenge} />
        <label>Код из SMS<input name="code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} pattern="[0-9]{6}" placeholder="000000" /></label>
        <Button variant="primary" className="" type="submit">Подтвердить и войти</Button>
        <ActionLink variant="secondary"  href={withApproval("/customer/login?mode=sms", approval)}>Запросить новый код</ActionLink>
      </form> : activeMode === "sms" ? <form action={requestCustomerLoginCodeAction} className="login-form">
        <input type="hidden" name="approval" value={approval ?? ""} />
        <label>Телефон<input name="phone" type="tel" autoComplete="tel" required maxLength={32} placeholder="+7 999 123-45-67" /></label>
        <Button variant="primary" className="" type="submit">Продолжить</Button>
        <ActionLink variant="secondary"  href={withApproval("/customer/login", approval)}>Войти по паролю</ActionLink>
      </form> : <>
        <form action={loginCustomerAction} className="login-form">
          <input type="hidden" name="approval" value={approval ?? ""} />
          <label>Телефон или e-mail<input name="identity" autoComplete="username" required maxLength={254} /></label>
          <label>Пароль<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
          <Button variant="primary" className="" type="submit">Войти в кабинет</Button>
        </form>
        <ActionLink variant="secondary"  href={withApproval("/customer/login?mode=sms", approval)}>Войти по телефону</ActionLink>
      </>}
      {approval && <ActionLink variant="secondary"  href={`/customer/register?approval=${encodeURIComponent(approval)}`}>Создать кабинет по этой ссылке</ActionLink>}
    </div></section>
  </main>;
}
