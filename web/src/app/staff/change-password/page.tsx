import { Button } from "@/components/action";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { BrandMark, Icon } from "@/components/icons";
import { changePasswordAction } from "./actions";

const errors: Record<string, string> = {
  invalid_password: `Пароли должны совпадать и содержать не менее ${MIN_PASSWORD_LENGTH} символов.`,
  invalid_current_password: "Временный пароль введён неверно.",
  server_unavailable: "Не удалось сменить пароль. Попробуйте ещё раз.",
};

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="login-page"><section className="login-story">
    <BrandMark />
    <div className="login-message"><span className="eyebrow light">Первый вход</span><h1>Защитите<br />учётную запись.</h1><p>Временный пароль известен только для запуска системы. Перед началом работы задайте свой.</p></div>
  </section><section className="login-panel"><div className="login-form-wrap">
    <p className="eyebrow">Сотрудник мастерской</p><h2>Смените пароль</h2><p className="muted login-subtitle">Новый пароль должен содержать не менее {MIN_PASSWORD_LENGTH} символов.</p>
    {error && <div className="form-error"><Icon name="alert" />{errors[error] ?? "Не удалось сменить пароль."}</div>}
    <form action={changePasswordAction} className="login-form">
      <label>Временный пароль<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} /></label>
      <label>Новый пароль<input name="newPassword" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={256} /></label>
      <label>Повторите новый пароль<input name="confirmation" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={256} /></label>
      <Button type="submit" variant="primary" className="">Сохранить пароль <Icon name="arrow-right" /></Button>
    </form>
  </div></section></main>;
}
