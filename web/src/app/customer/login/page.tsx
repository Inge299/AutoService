import Link from "next/link";
import { BrandMark } from "@/components/icons";
import { loginCustomerAction } from "@/app/customer/actions";

export const metadata = { title: "Вход клиента" };

export default async function CustomerLoginPage({ searchParams }: { searchParams: Promise<{ approval?: string; error?: string }> }) {
  const { approval, error } = await searchParams;
  return <main className="login-page"><section className="login-story"><Link href="/" className="login-brand"><BrandMark /></Link><div className="login-message"><span className="eyebrow light">Личный кабинет клиента</span><h1>Ваши автомобили.<br />Ваш ремонт.</h1><p>Следите за статусами, согласовывайте работы и храните историю обслуживания в одном месте.</p></div></section><section className="login-panel"><div className="login-form-wrap"><p className="eyebrow">Клиентский кабинет</p><h2>Войти</h2><p className="muted login-subtitle">Введите телефон или e-mail и пароль.</p>{error && <div className="form-error">Неверные данные для входа.</div>}<form action={loginCustomerAction} className="login-form"><input type="hidden" name="approval" value={approval ?? ""}/><label>Телефон или e-mail<input name="identity" autoComplete="username" required maxLength={254}/></label><label>Пароль<input name="password" type="password" autoComplete="current-password" required maxLength={256}/></label><button className="button button-primary" type="submit">Войти в кабинет</button></form>{approval && <Link className="text-link" href={`/customer/register?approval=${encodeURIComponent(approval)}`}>Создать кабинет по этой ссылке</Link>}</div></section></main>;
}
