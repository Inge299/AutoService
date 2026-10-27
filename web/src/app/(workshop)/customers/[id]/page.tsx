import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ListPagination, parsePage } from "@/components/list-pagination";
import { VisitRow } from "@/components/visit-row";
import { workshopRepository } from "@/lib/repository";
import { formatRub } from "@/lib/domain";

export const metadata = { title: "Карточка клиента" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long" }).format(new Date(value));

export default async function CustomerPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; futurePage?: string; vehicleId?: string }>;
}) {
  const { id } = await params, query = await searchParams;
  if (!uuid.test(id) || (query.vehicleId && !uuid.test(query.vehicleId))) notFound();
  const history = await workshopRepository.getCustomerHistory(id, parsePage(query.page), parsePage(query.futurePage), query.vehicleId);
  if (!history) notFound();
  const { customer, vehicles, visits, futureWork } = history;
  const path = `/customers/${id}`;
  const filter: Record<string, string> = query.vehicleId ? { vehicleId: query.vehicleId } : {};
  const selected = vehicles.find(v => v.id === query.vehicleId);
  return <>
    <Link href="/customers">← Клиентская база</Link>
    <PageHeader eyebrow="История обслуживания" title={customer.name || "Клиент"} description={customer.phone} />
    <a className="customer-phone" href={`tel:${customer.phone.replace(/[^+\d]/g, "")}`}>Позвонить: {customer.phone}</a>
    <section className="section-block customer-history-section" aria-label="Автомобили клиента">
      <div className="section-heading"><h2>Автомобили · {vehicles.length}</h2><Link href={path}>Вся история</Link></div>
      <div className="customer-vehicles">{vehicles.map(vehicle => <Link key={vehicle.id} href={`${path}?vehicleId=${vehicle.id}`}
        className={`content-card customer-vehicle ${selected?.id === vehicle.id ? "selected" : ""}`} aria-current={selected?.id === vehicle.id ? "page" : undefined}>
        <strong>{vehicle.label || "Без названия"}</strong><span>{vehicle.licensePlate || "Без номера"}</span><small>Визитов: {vehicle._count.visits}</small>
      </Link>)}</div>
      {!vehicles.length && <p>Автомобили пока не добавлены.</p>}
    </section>
    <section className="section-block customer-history-section">
      <div className="section-heading"><h2>{selected ? `${selected.label} · ${selected.licensePlate}` : "Все визиты"}</h2><span>Всего: {visits.total}</span></div>
      <div className="content-card list-card">{visits.items.map(visit => <div key={visit.id}>
        <VisitRow visit={visit} />
        {visit.recommendations && <div className="customer-recommendations"><strong>Рекомендации опубликованного отчёта</strong><p>{visit.recommendations}</p>{visit.nextVisitAt && <small>Следующий визит: {date(visit.nextVisitAt)}</small>}</div>}
      </div>)}{!visits.items.length && <p className="empty-state">Визитов на этой странице нет.</p>}
        <ListPagination path={path} {...visits} parameters={{ ...filter, futurePage: String(futureWork.page) }} />
      </div>
    </section>
    <section className="section-block customer-history-section">
      <div className="section-heading"><h2>Отложенные работы</h2><span>Всего: {futureWork.total}</span></div>
      <p>Работы, которые клиент отложил. Срок из отчёта относится ко всему следующему визиту. История сохраняется; выполнение проверяйте по последующим визитам.</p>
      <div className="customer-future-list">{futureWork.items.map(work => <article className="content-card customer-future" key={work.id}>
        <strong>{work.title}</strong><p>{work.description}</p><small>{work.visit.vehicleLabel} · {work.visit.licensePlate}</small>
        {work.priceRub !== null && <span>{formatRub(work.priceRub)}</span>}
        <p>{work.visit.report?.status === "PUBLISHED" && work.visit.report.nextVisitAt ? `Общий срок из отчёта: ${date(work.visit.report.nextVisitAt)}` : "Срок не назначен"}</p>
        <Link href={`/visits/${work.visitId}`}>Открыть исходный визит →</Link>
      </article>)}</div>
      {!futureWork.items.length && <p>Отложенных работ на этой странице нет.</p>}
      <ListPagination path={path} {...futureWork} pageKey="futurePage" parameters={{ ...filter, page: String(visits.page) }} />
      <Link href="/reminders">Перейти к журналу напоминаний →</Link>
    </section>
  </>;
}
