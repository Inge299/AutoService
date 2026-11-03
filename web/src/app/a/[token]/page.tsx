import { PublicUnavailable } from "@/components/public-unavailable";
import { CustomerContact } from "@/components/customer-contact";
import { CustomerHeader } from "@/components/customer-header";
import { ActionLink } from "@/components/action";
/* eslint-disable @next/next/no-img-element -- signed object-storage hosts are runtime-configured. */
import type { Metadata } from "next";
import { ApprovalDecision } from "@/app/a/[token]/approval-decision";
import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/status-pill";
import { getPublicApproval } from "@/lib/api/autoservice-api";
import { formatRub, priorityMeta } from "@/lib/domain";

export const metadata: Metadata = { title: "Согласование работ" };

export default async function ApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let approval;
  try {
    approval = await getPublicApproval(token);
  } catch {
    return <PublicUnavailable technical />;
  }
  if (!approval) return <PublicUnavailable />;
  const priority = priorityMeta[approval.finding.priority];
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
      <CustomerHeader phone={approval.workshop.phone} />
      <div className="customer-shell">
        <section className="customer-intro"><p className="customer-context">{approval.workshop.name}</p><h1>{approval.decision ? "Решение получено" : "Нужно ваше решение"}</h1><p>Мастер нашёл дополнительную работу и просит подтвердить её до продолжения ремонта.</p><div className="customer-car"><span><Icon name="car" /></span><div><strong>{approval.visit.vehicleLabel}</strong><small>{approval.visit.licensePlate} · {approval.visit.customerName}</small></div><StatusPill label={approvalStatus.label} tone={approvalStatus.tone} /></div></section>

        <div className="customer-layout">
          <section className="approval-detail">
            <div className="approval-heading"><StatusPill label={priority.label} tone={priority.tone} /></div>
            <h2>{approval.finding.title}</h2>
            <p className="approval-lead">{approval.finding.description}</p>
            {approval.media.length > 0 && <div className="evidence-media" aria-label="Материалы мастера">{approval.media.map((media) => media.kind === "PHOTO" ? <figure key={media.id}><img src={media.url} alt="Материал мастера" /><figcaption><Icon name="camera" /> Фото мастера</figcaption></figure> : media.kind === "VIDEO" ? <figure key={media.id}><video controls preload="metadata" src={media.url} /><figcaption><Icon name="camera" /> Видео мастера</figcaption></figure> : <figure key={media.id}><audio controls preload="metadata" src={media.url} /><figcaption><Icon name="phone" /> Голосовая заметка</figcaption></figure>)}</div>}
            <div className="price-box"><div><small>Стоимость работы</small><strong>{formatRub(approval.finding.priceRub)}</strong></div><p>Работа и материалы включены. Изменение стоимости потребует нового согласования.</p></div>
          </section>
          <aside className="customer-decision"><ApprovalDecision token={token} priceRub={approval.finding.priceRub} initialDecision={approval.decision} /><CustomerContact phone={approval.workshop.phone} /><ActionLink variant="secondary"  href={`/customer/login?approval=${encodeURIComponent(token)}`}>Личный кабинет</ActionLink><ActionLink variant="secondary"  href={`/customer/register?approval=${encodeURIComponent(token)}`}>Создать кабинет</ActionLink></aside>
        </div>
      </div>
      <footer className="customer-footer"><span>AutoService</span></footer>
    </main>
  );
}
