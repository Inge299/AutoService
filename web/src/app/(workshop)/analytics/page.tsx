import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { formatRub } from "@/lib/domain";

export const metadata: Metadata = { title: "Результаты" };

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader eyebrow="7–12 сентября" title="Результаты мастерской" description="Только показатели, которые помогают проверить ценность AutoService." />
      <section className="metric-grid analytics-metrics"><article className="metric-card"><div><small>Отправлено согласований</small><strong>18</strong><p>14 ссылок открыто</p></div></article><article className="metric-card"><div><small>Конверсия в решение</small><strong>67%</strong><p><b>12 из 18</b> дали ответ</p></div></article><article className="metric-card"><div><small>Согласованная выручка</small><strong>{formatRub(42_300)}</strong><p><b>+18%</b> за неделю</p></div></article><article className="metric-card"><div><small>Опубликовано отчётов</small><strong>9</strong><p>из 11 завершённых визитов</p></div></article></section>
      <div className="analytics-grid"><section className="content-card chart-card"><div className="section-heading"><div><h2>Согласованная выручка</h2><p>По дням недели</p></div><strong>{formatRub(42_300)}</strong></div><div className="bar-chart">{[["Пн",32],["Вт",52],["Ср",45],["Чт",68],["Пт",58],["Сб",92]].map(([day,value]) => <div key={day}><span style={{height:`${value}%`}} /><small>{day}</small></div>)}</div></section><section className="content-card funnel-card"><h2>Воронка согласования</h2>{[["Отправлено","18","100%"],["Открыто","14","78%"],["Получено решение","12","67%"],["Согласовано","8","44%"]].map(([label,value,percent]) => <div className="funnel-row" key={label}><span><strong>{label}</strong><small>{percent}</small></span><b>{value}</b></div>)}</section></div>
      <p className="demo-data-note">Показатели сейчас демонстрационные. Подключение реальных данных требует read/analytics endpoint’ов backend.</p>
    </>
  );
}
