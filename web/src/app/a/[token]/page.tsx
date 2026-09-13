import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApprovalDecision } from "@/app/a/[token]/approval-decision";
import { BrandMark, Icon } from "@/components/icons";
import { StatusPill } from "@/components/status-pill";
import { getPublicApproval } from "@/lib/api/autoservice-api";
import { formatRub, priorityMeta } from "@/lib/domain";

export const metadata: Metadata = { title: "Согласование работ" };

export default async function ApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const approval = await getPublicApproval(token);
  if (!approval) notFound();
  const priority = priorityMeta[approval.finding.priority];
  const expiresAt = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(new Date(approval.expiresAt));
  const phoneLink = approval.workshop.phone?.replace(/[^+\d]/g, "");

  return (
    <main className="customer-page">
      <header className="customer-header"><BrandMark />{approval.workshop.phone && <a href={`tel:${phoneLink}`}><Icon name="phone" /> {approval.workshop.phone}</a>}</header>
      <div className="customer-shell">
        <section className="customer-intro"><span className="eyebrow">{approval.workshop.name}</span><h1>{approval.decision ? "Решение получено" : "Нужно ваше решение"}</h1><p>Во время диагностики мастерская нашла дополнительную работу и просит подтвердить её до продолжения ремонта.</p><div className="customer-car"><span><Icon name="car" /></span><div><strong>{approval.visit.vehicleLabel}</strong><small>{approval.visit.licensePlate} · {approval.visit.customerName}</small></div><StatusPill label="На согласовании" tone="warning" /></div></section>

        <div className="customer-layout">
          <section className="approval-detail">
            <div className="approval-heading"><StatusPill label={priority.label} tone={priority.tone} /><span>Рекомендация мастерской</span></div>
            <h2>{approval.finding.title}</h2>
            <p className="approval-lead">{approval.finding.description}</p>
            {approval.finding.mediaCount ? <div className="evidence-photo"><div className="brake-visual"><span className="brake-disc"/><span className="brake-caliper"/></div><span className="photo-caption"><Icon name="camera" /> Материалы мастера · {approval.finding.mediaCount}</span></div> : <div className="empty-inline"><Icon name="camera" /><p><strong>Материалы не приложены</strong><small>Решение можно принять по описанию или запросить звонок.</small></p></div>}
            <div className="price-box"><div><small>Стоимость работы</small><strong>{formatRub(approval.finding.priceRub)}</strong></div><p>Работа и материалы включены. Изменение стоимости потребует нового согласования.</p></div>
          </section>
          <aside><ApprovalDecision token={token} priceRub={approval.finding.priceRub} initialDecision={approval.decision} /><div className="customer-help"><Icon name="phone" /><p><strong>Остались вопросы?</strong><small>Позвоните в мастерскую или выберите «Нужен звонок».</small></p></div></aside>
        </div>
      </div>
      <footer className="customer-footer"><span>AutoService</span><p>Защищённая персональная ссылка · действует до {expiresAt}</p></footer>
    </main>
  );
}
