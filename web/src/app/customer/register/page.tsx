import Link from "next/link";
import { BrandMark, Icon } from "@/components/icons";
import { registerCustomerAction, requestCustomerRegistrationCodeAction, verifyCustomerRegistrationCallAction } from "@/app/customer/actions";

export const metadata = { title: "Создать кабинет клиента" };

const errors: Record<string, string> = {
  invalid_data: "Проверьте заполненные поля.",
  invalid_code: "Неверный или просроченный код.",
  too_many_attempts: "Слишком много запросов. Подождите немного и повторите попытку.",
  sms_unavailable: "Не удалось отправить SMS. Попробуйте позже.",
  call_pending: "Звонок ещё не подтверждён. Позвоните с указанного номера и проверьте снова.",
  registration_failed: "Не удалось создать кабинет. Проверьте данные или войдите в существующий.",
};

export default async function CustomerRegisterPage({ searchParams }: {
  searchParams: Promise<{ approval?: string; challenge?: string; error?: string; mode?: string; callPhone?: string; callPhonePretty?: string; verified?: string }>;
}) {
  const { approval, challenge, error, mode, callPhone, callPhonePretty, verified } = await searchParams;
  const dialPhone = callPhone?.replace(/[^\d+]/g, "");
  if (!approval) return <main className="login-page"><section className="login-panel"><div className="login-form-wrap"><BrandMark /><h2>Нужна персональная ссылка</h2><p className="muted login-subtitle">Откройте ссылку согласования, которую прислала мастерская, и создайте кабинет из неё.</p><Link className="button button-secondary" href="/customer/login">У меня уже есть кабинет</Link></div></section></main>;

  return <main className="login-page">
    <section className="login-story">
      <Link href="/" className="login-brand"><BrandMark /></Link>
      <div className="login-message"><span className="eyebrow light">Личный кабинет клиента</span><h1>Все автомобили<br />и ремонты — рядом.</h1><p>Перед созданием кабинета мы отправим код на телефон из заявки. Так доступ к истории ремонта получит именно владелец номера.</p></div>
    </section>
    <section className="login-panel"><div className="login-form-wrap">
      <p className="eyebrow">{challenge ? "Подтверждение номера" : "Первый вход"}</p>
      <h2>{mode === "call" ? "Позвоните для подтверждения" : challenge ? "Создайте кабинет" : "Подтвердите телефон"}</h2>
      <p className="muted login-subtitle">{mode === "call" ? "Позвоните с номера из заявки. Звонок будет сброшен автоматически." : verified === "call" ? "Номер подтверждён. Укажите e-mail и пароль для резервного входа." : challenge ? "Введите код из SMS. Затем укажите e-mail и пароль для резервного входа." : "Подтвердите номер из заявки звонком."}</p>
      {error && <div className="form-error"><Icon name="alert" />{errors[error] ?? "Не удалось продолжить."}</div>}
      {mode === "call" && challenge && dialPhone ? <form action={verifyCustomerRegistrationCallAction} className="login-form">
        <input type="hidden" name="approval" value={approval} />
        <input type="hidden" name="challenge" value={challenge} />
        <input type="hidden" name="callPhone" value={dialPhone} />
        <input type="hidden" name="callPhonePretty" value={callPhonePretty ?? dialPhone} />
        <a className="button button-secondary" href={`tel:${dialPhone}`}>{callPhonePretty ?? dialPhone}</a>
        <button className="button button-primary" type="submit">Я позвонил — проверить</button>
        <Link className="text-link" href={`/customer/register?approval=${encodeURIComponent(approval)}`}>Запросить заново</Link>
      </form> : challenge ? <form action={registerCustomerAction} className="login-form">
        <input type="hidden" name="approval" value={approval} />
        <input type="hidden" name="challenge" value={challenge} />
        <input type="hidden" name="verified" value={verified ?? ""} />
        {verified !== "call" && <label>Код из SMS<input name="code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} pattern="[0-9]{6}" placeholder="000000" /></label>}
        <label>E-mail<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.ru" /></label>
        <label>Пароль<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={256} placeholder="Не менее 8 символов" /></label>
        <button className="button button-primary" type="submit">Создать и перейти в кабинет</button>
        <Link className="text-link" href={`/customer/register?approval=${encodeURIComponent(approval)}`}>Запросить подтверждение заново</Link>
      </form> : <form action={requestCustomerRegistrationCodeAction} className="login-form">
        <input type="hidden" name="approval" value={approval} />
        <button className="button button-primary" type="submit">Подтвердить звонком</button>
      </form>}
      <p className="security-note">Подтверждение одноразовое. AutoService не показывает номер из заявки и не хранит секреты в открытом виде.</p>
      <Link className="text-link" href={`/customer/login?approval=${encodeURIComponent(approval)}`}>У меня уже есть кабинет</Link>
    </div></section>
  </main>;
}
