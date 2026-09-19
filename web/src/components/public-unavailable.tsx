import { CustomerHeader } from "@/components/customer-header";
import { ActionLink } from "@/components/action";
import { Icon } from "@/components/icons";

export function PublicUnavailable({ technical = false, title = "Согласование работ" }: { technical?: boolean; title?: string }) {
  return <main className="customer-page"><CustomerHeader /><div className="customer-shell public-link-unavailable">
    <section className="public-link-unavailable-card">
      <span className="public-link-unavailable-icon"><Icon name={technical ? "refresh" : "alert"} /></span>
      <p className="eyebrow">{title}</p><h1>{technical ? "Сервис временно недоступен" : "Ссылка недействительна"}</h1>
      <p>{technical ? "Не удалось открыть страницу. Попробуйте обновить её немного позже." : "Эта ссылка не существует, была отозвана или срок её действия истёк."}</p>
      {!technical && <p>Попросите мастерскую отправить новую ссылку.</p>}
      <ActionLink href="/cabinet">Личный кабинет</ActionLink>
    </section>
  </div><footer className="customer-footer"><span>AutoService</span><p>Защищённая персональная ссылка</p></footer></main>;
}
