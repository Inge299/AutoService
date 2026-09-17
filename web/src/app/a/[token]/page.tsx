/* eslint-disable @next/next/no-img-element -- signed object-storage hosts are runtime-configured. */
import type { Metadata } from "next";
import { ApprovalDecision } from "@/app/a/[token]/approval-decision";
import { BrandMark, Icon } from "@/components/icons";
import { StatusPill } from "@/components/status-pill";
import { getPublicApproval } from "@/lib/api/autoservice-api";
import { formatRub, priorityMeta } from "@/lib/domain";
import Link from "next/link";

export const metadata: Metadata = { title: "Согласование работ" };

function UnavailableApprovalPage({ technical = false }: { technical?: boolean }) {
  return (
    <main className="customer-page">
      <header className="customer-header"><BrandMark /></header>
      <div className="customer-shell public-link-unavailable">
        <section className="public-link-unavailable-card">
          <span className="public-link-unavailable-icon"><Icon name={technical ? "refresh" : "alert"} /></span>
          <p className="eyebrow">Согласование работ</p>
          <h1>{technical ? "Сервис временно недоступен" : "Ссылка недействительна"}</h1>
          <p>{technical
            ? "Не удалось открыть согласование. Попробуйте обновить страницу немного позже."
            : "Эта ссылка не существует, была отозвана или срок её действия истёк."}</p>
          {!technical && <p className="public-link-unavailable-note">Попросите мастерскую отправить новую ссылку на согласование.</p>}
          <Link className="button button-secondary" href="/customer/login">Перейти в личный кабинет</Link>
        </section>
      </div>
      <footer className="customer-footer"><span>AutoService</span><p>Защищённая персональная ссылка</p></footer>
    </main>
  );
}

export default async function ApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let approval;
  try {
    approval = await getPublicApproval(token);
  } catch {
    return <UnavailableApprovalPage technical />;
  }
  if (!approval) return <UnavailableApprovalPage />;
  const priority = priorityMeta[approval.finding.priority];
  const expiresAt = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(new Date(approval.expiresAt));
  const phoneLink = approval.workshop.phone?.replace(/[^+\d]/g, "");
  const approvalStatus = approval.decision
    ? {
        APPROVED: { label: "Согласовано", tone: "success" },
        DECLINED: { label: "Отклонено", tone: "danger" },
        DEFERRED: { label: "Отложено", tone: "neutral" },
        CALL_REQUESTED: { label: "Запрошен звонок", tone: "warning" },
      }[approval.decision.value]
    : { label: "На согласовании", tone: "warning" };

  return (
    <main className="customer-page">
      <header className="customer-header"><BrandMark />{approval.workshop.phone && <a href={`tel:${phoneLink}`}><Icon name="phone" /> {approval.workshop.phone}</a>}</header>
      <div className="customer-shell">
        <section className="customer-intro"><span className="eyebrow">{approval.workshop.name}</span><h1>{approval.decision ? "Решение получено" : "Нужно ваше решение"}</h1><p>Во время диагностики мастерская нашла дополнительную работу и просит подтвердить её до продолжения ремонта.</p><div className="customer-car"><span><Icon name="car" /></span><div><strong>{approval.visit.vehicleLabel}</strong><small>{approval.visit.licensePlate} · {approval.visit.customerName}</small></div><StatusPill label={approvalStatus.label} tone={approvalStatus.tone} /></div></section>

        <div className="customer-layout">
          <section className="approval-detail">
            <div className="approval-heading"><StatusPill label={priority.label} tone={priority.tone} /><span>Рекомендация мастерской</span></div>
            <h2>{approval.finding.title}</h2>
            <p className="approval-lead">{approval.finding.description}</p>
            {approval.media.length ? <div className="evidence-media" aria-label="Материалы мастера">{approval.media.map((media) => media.kind === "PHOTO" ? <figure key={media.id}><img src={media.url} alt="Материал мастера" /><figcaption><Icon name="camera" /> Фото мастера</figcaption></figure> : media.kind === "VIDEO" ? <figure key={media.id}><video controls preload="metadata" src={media.url} /><figcaption><Icon name="camera" /> Видео мастера</figcaption></figure> : <figure key={media.id}><audio controls preload="metadata" src={media.url} /><figcaption><Icon name="phone" /> Голосовая заметка</figcaption></figure>)}</div> : <div className="empty-inline"><Icon name="camera" /><p><strong>Материалы не приложены</strong><small>Решение можно принять по описанию или запросить звонок.</small></p></div>}
            <div className="price-box"><div><small>Стоимость работы</small><strong>{formatRub(approval.finding.priceRub)}</strong></div><p>Работа и материалы включены. Изменение стоимости потребует нового согласования.</p></div>
          </section>
          <aside className="customer-decision">{!approval.media.length && <div className="customer-help"><Icon name="camera" /><p><strong>Материалы ещё не прикреплены</strong><small>Вы можете принять решение по описанию или запросить звонок мастера.</small></p></div>}<ApprovalDecision token={token} priceRub={approval.finding.priceRub} initialDecision={approval.decision} /><div className="customer-help"><Icon name="phone" /><p><strong>Остались вопросы?</strong><small>{approval.workshop.phone ? <>Позвоните по номеру <a href={`tel:${phoneLink}`}>{approval.workshop.phone}</a> или выберите «Нужен звонок».</> : <>Выберите «Нужен звонок», и мастерская свяжется с вами.</>}</small></p></div><Link className="button button-secondary" href={`/customer/register?approval=${encodeURIComponent(token)}`}>Открыть личный кабинет</Link><Link className="text-link" href={`/customer/login?approval=${encodeURIComponent(token)}`}>Уже есть кабинет? Войти</Link></aside>
        </div>
      </div>
      <footer className="customer-footer"><span>AutoService</span><p>Защищённая персональная ссылка · действует до {expiresAt}</p></footer>
    </main>
  );
}
