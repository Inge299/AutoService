import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApprovalDecision } from "@/app/a/[token]/approval-decision";
import { BrandMark, Icon } from "@/components/icons";
import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "Согласование работ" };

export default async function ApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token !== "demo-brakes") notFound();
  return (
    <main className="customer-page">
      <header className="customer-header"><BrandMark /><a href="tel:+73532552020"><Icon name="phone" /> +7 3532 55-20-20</a></header>
      <div className="customer-shell">
        <section className="customer-intro"><span className="eyebrow">АвтоСфера · Оренбург</span><h1>Нужно ваше решение</h1><p>Во время диагностики нашли работу, которую мастер хочет согласовать до продолжения ремонта.</p><div className="customer-car"><span><Icon name="car" /></span><div><strong>Toyota Camry</strong><small>А123АА 56 · Иван Петров</small></div><StatusPill label="На диагностике" tone="info" /></div></section>

        <div className="customer-layout">
          <section className="approval-detail">
            <div className="approval-heading"><StatusPill label="Критично" tone="danger" /><span>Рекомендация №1</span></div>
            <h2>Износ задних тормозных колодок</h2>
            <p className="approval-lead">Остаток фрикционного материала около 2 мм. Рекомендуем заменить колодки в этот визит, чтобы сохранить безопасное торможение.</p>
            <div className="evidence-photo"><div className="brake-visual"><span className="brake-disc"/><span className="brake-caliper"/></div><span className="photo-caption"><Icon name="camera" /> Фото мастера · сегодня, 12:16</span></div>
            <div className="evidence-thumbs"><button className="active"><span className="tiny-disc" />Общий вид</button><button><span className="tiny-disc close" />Крупный план</button><button><Icon name="camera" />Ещё 1 фото</button></div>
            <div className="price-box"><div><small>Ориентировочная стоимость</small><strong>12 800 ₽</strong></div><p>Работа и материалы включены. Итоговая стоимость не изменится без нового согласования.</p></div>
            <div className="master-note"><span>А</span><p><strong>Комментарий мастера Алексея</strong>«Колодки уже на минимальном остатке. Лучше заменить сейчас, диски пока в хорошем состоянии».</p></div>
          </section>
          <aside><ApprovalDecision /><div className="customer-help"><Icon name="phone" /><p><strong>Остались вопросы?</strong><small>Позвоните в мастерскую или выберите «Нужен звонок».</small></p></div></aside>
        </div>
      </div>
      <footer className="customer-footer"><span>AutoService</span><p>Защищённая страница · ссылка действует до 15 сентября</p></footer>
    </main>
  );
}
