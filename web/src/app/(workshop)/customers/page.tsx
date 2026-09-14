import type { Metadata } from "next";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { workshopRepository } from "@/lib/repository";

export const metadata: Metadata = { title: "Клиенты" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const customers = await workshopRepository.listCustomers(q);
  return (
    <>
      <PageHeader eyebrow="Клиентская база" title="Клиенты и автомобили" description="История формируется автоматически из визитов." />
      <section className="content-card list-card">
        <div className="list-toolbar"><form className="search-field"><Icon name="search" /><input name="q" defaultValue={q} placeholder="Имя, телефон, автомобиль или госномер" /><button>Найти</button></form><span className="result-count">{customers.length} клиентов</span></div>
        <div className="customer-table">
          <div className="table-head"><span>Клиент</span><span>Автомобиль</span><span>Визиты</span><span>Следующий контакт</span></div>
          {customers.map((customer) => { const primaryVehicle = customer.vehicles[0] ?? "Автомобиль не указан"; return <article className="customer-row" key={customer.id}>
            <span className="customer-name"><i>{customer.name.slice(0, 1)}</i><span><strong>{customer.name}</strong><small>{customer.phone}</small></span></span>
            <span><strong>{primaryVehicle.split(" · ")[0]}</strong><small>{primaryVehicle.split(" · ")[1]}</small></span>
            <span><strong>{customer.visitsCount}</strong><small>Последний: {customer.lastVisit.toLowerCase()}</small></span>
            <span>{customer.nextContact ? <><strong>{customer.nextContact.split(" · ")[0]}</strong><small>{customer.nextContact.split(" · ")[1] ?? "Запланировано"}</small></> : <small>Не назначен</small>}</span>
          </article>; })}
          {!customers.length && <div className="empty-state"><Icon name="search" /><h3>Клиентов пока нет</h3><p>Карточки появятся автоматически после загрузки визитов.</p></div>}
        </div>
      </section>
    </>
  );
}
