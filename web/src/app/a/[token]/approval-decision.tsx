"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

type Decision = "APPROVED" | "DECLINED" | "DEFERRED" | "CALL_REQUESTED";

const labels: Record<Decision, { title: string; text: string }> = {
  APPROVED: { title: "Работа согласована", text: "Мастерская получила ваше решение и может продолжить ремонт." },
  DECLINED: { title: "Работа отклонена", text: "Мастерская увидит решение и не будет выполнять эту работу." },
  DEFERRED: { title: "Работа отложена", text: "Рекомендация сохранится в истории автомобиля." },
  CALL_REQUESTED: { title: "Запрошен звонок", text: "Мастерская свяжется с вами, чтобы ответить на вопросы." },
};

export function ApprovalDecision() {
  const [decision, setDecision] = useState<Decision | null>(null);
  if (decision) return <div className="decision-result"><span><Icon name="check" /></span><h3>{labels[decision].title}</h3><p>{labels[decision].text}</p><small>Решение сохранено · 12 сентября, 12:48</small></div>;

  return (
    <div className="decision-panel">
      <h2>Ваше решение</h2><p>Выберите один вариант. После сохранения мастерская сразу увидит ответ.</p>
      <button onClick={() => setDecision("APPROVED")} className="customer-action approve"><Icon name="check" /><span><strong>Согласовать</strong><small>Выполнить работу за 12 800 ₽</small></span><Icon name="arrow-right" /></button>
      <div className="secondary-decisions"><button onClick={() => setDecision("CALL_REQUESTED")}><Icon name="phone" /><span><strong>Нужен звонок</strong><small>Хочу уточнить детали</small></span></button><button onClick={() => setDecision("DEFERRED")}><Icon name="clock" /><span><strong>Отложить</strong><small>Вернуться позже</small></span></button></div>
      <button onClick={() => setDecision("DECLINED")} className="decline-link">Не выполнять эту работу</button>
      <p className="preview-note"><Icon name="alert" /> Сейчас это интерактивный предпросмотр. Сохранение на сервер включится после появления approval endpoint.</p>
    </div>
  );
}
