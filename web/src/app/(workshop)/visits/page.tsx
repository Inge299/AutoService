import { ActionLink, Button } from "@/components/action";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { VisitRow } from "@/components/visit-row";
import { visitStatusMeta, type VisitStatus } from "@/lib/domain";
import { workshopRepository } from "@/lib/repository";

export const metadata: Metadata = { title: "Визиты" };

const filters: Array<{ value?: VisitStatus; label: string }> = [
  { label: "Все" }, { value: "DRAFT", label: "Черновики" }, { value: "IN_REPAIR", label: "В ремонте" }, { value: "WAITING_APPROVAL", label: "Ждут решения" }, { value: "COMPLETED", label: "Завершённые" },
];

export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: VisitStatus }> }) {
  const params = await searchParams;
  const activeStatus = filters.some((item) => item.value === params.status) ? params.status : undefined;
  const hasFilters = Boolean(params.q?.trim() || activeStatus);
  const visits = await workshopRepository.listVisits({ query: params.q, status: activeStatus });
  return (
    <>
      <PageHeader eyebrow="Рабочий журнал" title="Визиты" description="Все автомобили, которые проходили через мастерскую." />
      <section className="content-card list-card">
        <div className="list-toolbar">
          <form className="search-field"><Icon name="search" /><input name="q" defaultValue={params.q} placeholder="Автомобиль, госномер, клиент или телефон" /><Button>Найти</Button></form>
          <span className="result-count">{visits.length} {visits.length === 1 ? "визит" : "визитов"}</span>
        </div>
        <div className="filter-tabs">
          {filters.map((filter) => {
            const href = filter.value ? `/visits?status=${filter.value}${params.q ? `&q=${encodeURIComponent(params.q)}` : ""}` : `/visits${params.q ? `?q=${encodeURIComponent(params.q)}` : ""}`;
            return <Link key={filter.label} href={href} className={activeStatus === filter.value ? "active" : undefined}>{filter.label}{filter.value && <small>{visitStatusMeta[filter.value].label === filter.label ? "" : ""}</small>}</Link>;
          })}
        </div>
        <div className="visit-list">{visits.length ? visits.map((visit) => <VisitRow key={visit.id} visit={visit} />) : <div className="empty-state"><Icon name={hasFilters ? "search" : "car"} /><h3>{hasFilters ? "Ничего не найдено" : "Визитов пока нет"}</h3><p>{hasFilters ? "Попробуйте изменить запрос или сбросить фильтр." : "Первый визит появится после синхронизации с сервером."}</p>{hasFilters && <ActionLink variant="secondary" href="/visits" >Сбросить фильтры</ActionLink>}</div>}</div>
      </section>
    </>
  );
}
