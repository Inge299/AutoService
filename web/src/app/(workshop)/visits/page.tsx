import { ActionLink } from "@/components/action";
import { ListSearch } from "@/components/list-search";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { VisitRow } from "@/components/visit-row";
import { visitStatusMeta, type VisitStatus } from "@/lib/domain";
import { workshopRepository } from "@/lib/repository";
import { ListPagination, parsePage } from "@/components/list-pagination";

export const metadata: Metadata = { title: "Визиты" };

const filters: Array<{ value?: VisitStatus; label: string }> = [
  { label: "Все" }, { value: "DRAFT", label: "Черновики" }, { value: "IN_REPAIR", label: "В ремонте" }, { value: "WAITING_APPROVAL", label: "Ждут решения" }, { value: "COMPLETED", label: "Завершённые" },
];

export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: VisitStatus; page?: string }> }) {
  const params = await searchParams;
  const activeStatus = filters.some((item) => item.value === params.status) ? params.status : undefined;
  const hasFilters = Boolean(params.q?.trim() || activeStatus);
  const result = await workshopRepository.listVisitPage({ query: params.q, status: activeStatus }, parsePage(params.page));
  const visits = result.items;
  return (
    <>
      <PageHeader eyebrow="Рабочий журнал" title="Визиты" description="Все автомобили, которые проходили через мастерскую." />
      <section className="content-card list-card">
        <div className="list-toolbar">
          <ListSearch query={params.q} status={activeStatus} label="Поиск визитов" placeholder="Автомобиль, госномер, клиент или телефон" />
          <span className="result-count">Всего: {result.total}</span>
        </div>
        <div className="filter-tabs">
          {filters.map((filter) => {
            const href = filter.value ? `/visits?status=${filter.value}${params.q ? `&q=${encodeURIComponent(params.q)}` : ""}` : `/visits${params.q ? `?q=${encodeURIComponent(params.q)}` : ""}`;
            return <Link key={filter.label} href={href} className={activeStatus === filter.value ? "active" : undefined}>{filter.label}{filter.value && <small>{visitStatusMeta[filter.value].label === filter.label ? "" : ""}</small>}</Link>;
          })}
        </div>
        <div className="visit-list">{visits.length ? visits.map((visit) => <VisitRow key={visit.id} visit={visit} />) : <div className="empty-state"><Icon name={hasFilters ? "search" : "car"} /><h3>{hasFilters ? "Ничего не найдено" : "Визитов пока нет"}</h3><p>{hasFilters ? "Попробуйте изменить запрос или сбросить фильтр." : "Первый визит появится после приёмки автомобиля."}</p>{hasFilters && <ActionLink variant="secondary" href="/visits" >Сбросить фильтры</ActionLink>}</div>}</div>
        <ListPagination path="/visits" {...result} query={params.q} status={activeStatus} />
      </section>
    </>
  );
}
