import { Button } from "@/components/action";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { getApiSession, listApiAdminUsers } from "@/lib/api/autoservice-api";
import { requireSession } from "@/lib/auth/session";
import {
  createUserAction,
  resetUserPasswordAction,
  setUserRoleAction,
  setUserStateAction,
} from "./actions";

export const metadata: Metadata = { title: "Пользователи" };

const messages: Record<string, string> = {
  user_created: "Пользователь создан и может войти в систему.",
  user_enabled: "Доступ пользователя включён.",
  user_disabled: "Доступ пользователя отключён. Его активные сессии больше не дают доступ к API.",
  role_updated: "Роль пользователя обновлена.",
  password_updated: "Новый пароль сохранён.",
};

const errors: Record<string, string> = {
  invalid_input: "Проверьте поля. Логин — от 3 символов, пароль — от 8.",
  password_length: "Пароль должен содержать не менее 8 символов.",
  login_taken: "Этот логин уже используется.",
  phone_taken: "Этот телефон уже привязан к другому пользователю.",
  cannot_disable_self: "Нельзя отключить свою учётную запись.",
  cannot_demote_self: "Нельзя снять с себя роль администратора.",
  last_admin: "В мастерской должен остаться хотя бы один активный администратор.",
  operation_failed: "Операция не выполнена. Повторите позже.",
};

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const session = await requireSession();
  const current = await getApiSession(session);
  if (current.role !== "ADMIN") redirect("/dashboard");
  const [users, query] = await Promise.all([listApiAdminUsers(session), searchParams]);

  return <>
    <PageHeader eyebrow="Администрирование" title="Пользователи мастерской" description="Выдавайте доступ, меняйте роли и блокируйте учётные записи." />
    {query.success && messages[query.success] && <div className="admin-notice admin-notice-success">{messages[query.success]}</div>}
    {query.error && <div className="admin-notice admin-notice-error">{errors[query.error] ?? errors.operation_failed}</div>}

    <section className="content-card admin-create-card">
      <div><h2>Новый пользователь</h2><p>После создания учётная запись сразу активна.</p></div>
      <form action={createUserAction} className="admin-create-form">
        <label>Логин<input name="login" minLength={3} maxLength={64} required placeholder="ivan.petrov" autoComplete="off" /></label>
        <label>Имя<input name="displayName" minLength={2} maxLength={120} required placeholder="Иван Петров" /></label>
        <label>Телефон <small>необязательно</small><input name="phone" maxLength={32} placeholder="+7 999 000-00-00" /></label>
        <label>Роль<select name="role" defaultValue="EMPLOYEE"><option value="EMPLOYEE">Сотрудник</option><option value="ADMIN">Администратор</option></select></label>
        <label>Временный пароль<input name="password" type="password" minLength={8} maxLength={256} required autoComplete="new-password" placeholder="Минимум 8 символов" /></label>
        <Button variant="primary" className="" type="submit">Создать пользователя</Button>
      </form>
    </section>

    <section className="content-card admin-users-card">
      <div className="admin-users-heading"><div><h2>Доступ к системе</h2><p>{users.length} учётных записей</p></div><StatusPill label={`${users.filter((user) => user.isActive).length} активны`} tone="success" /></div>
      <div className="admin-users-list">
        {users.map((user) => <article className="admin-user-row" key={user.id}>
          <div className="admin-user-identity"><span>{user.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName}{user.isCurrent ? " · вы" : ""}</strong><small>@{user.login || "логин не назначен"}{user.phone ? ` · ${user.phone}` : ""}</small></div></div>
          <StatusPill label={user.isActive ? "Активен" : "Отключён"} tone={user.isActive ? "success" : "neutral"} />
          <form action={setUserRoleAction} className="admin-inline-form">
            <input type="hidden" name="userId" value={user.id} />
            <select name="role" defaultValue={user.role} disabled={user.isCurrent}><option value="EMPLOYEE">Сотрудник</option><option value="ADMIN">Администратор</option></select>
            {!user.isCurrent && <Button type="submit" variant="secondary" className=" button-small">Сохранить</Button>}
          </form>
          <form action={resetUserPasswordAction} className="admin-inline-form admin-password-form">
            <input type="hidden" name="userId" value={user.id} />
            <input name="password" type="password" minLength={8} maxLength={256} required autoComplete="new-password" placeholder="Новый пароль" />
            <Button type="submit" variant="secondary" className=" button-small">Сменить</Button>
          </form>
          <form action={setUserStateAction}>
            <input type="hidden" name="userId" value={user.id} /><input type="hidden" name="isActive" value={String(!user.isActive)} />
            <Button type="submit" disabled={user.isCurrent} className={`button button-small ${user.isActive ? "button-danger" : "button-primary"}`}>{user.isActive ? "Отключить" : "Включить"}</Button>
          </form>
        </article>)}
      </div>
    </section>
  </>;
}
