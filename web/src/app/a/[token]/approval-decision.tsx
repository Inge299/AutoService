"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import type { ApprovalDecisionValue } from "@/lib/api/autoservice-api";
import { formatRub } from "@/lib/domain";

const labels: Record<ApprovalDecisionValue, { title: string; text: string }> = {
  APPROVED: { title: "Работа согласована", text: "Мастерская получила ваше решение и может продолжить ремонт." },
  DECLINED: { title: "Работа отклонена", text: "Мастерская получила решение и не будет выполнять эту работу." },
  DEFERRED: { title: "Работа отложена", text: "Рекомендация сохранена в истории автомобиля." },
  CALL_REQUESTED: { title: "Запрошен звонок", text: "Мастерская свяжется с вами, чтобы ответить на вопросы." },
};

interface SavedDecision {
  value: ApprovalDecisionValue;
  createdAt: string;
}

export function ApprovalDecision({
  token,
  priceRub,
  initialDecision,
}: {
  token: string;
  priceRub: number;
  initialDecision: SavedDecision | null;
}) {
  const [decision, setDecision] = useState<SavedDecision | null>(initialDecision);
  const [pending, setPending] = useState<ApprovalDecisionValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(value: ApprovalDecisionValue) {
    setPending(value);
    setError(null);
    try {
      const response = await fetch(`/api/public/approvals/${encodeURIComponent(token)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) throw new Error(response.status === 409 ? "Решение по этой ссылке уже сохранено." : "Не удалось сохранить решение.");
      setDecision(await response.json() as SavedDecision);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить решение.");
    } finally {
      setPending(null);
    }
  }

  if (decision) {
    const savedAt = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(decision.createdAt));
    return <div className="decision-result"><span><Icon name="check" /></span><h3>{labels[decision.value].title}</h3><p>{labels[decision.value].text}</p><small>Решение сохранено на сервере · {savedAt}</small></div>;
  }

  return (
    <div className="decision-panel">
      <h2>Ваше решение</h2><p>Выберите один вариант. После сохранения мастерская сразу увидит ответ.</p>
      <button disabled={Boolean(pending)} onClick={() => save("APPROVED")} className="customer-action approve"><Icon name="check" /><span><strong>{pending === "APPROVED" ? "Сохраняем…" : "Согласовать"}</strong><small>Выполнить работу за {formatRub(priceRub)}</small></span><Icon name="arrow-right" /></button>
      <div className="secondary-decisions"><button disabled={Boolean(pending)} onClick={() => save("CALL_REQUESTED")}><Icon name="phone" /><span><strong>Нужен звонок</strong><small>Хочу уточнить детали</small></span></button><button disabled={Boolean(pending)} onClick={() => save("DEFERRED")}><Icon name="clock" /><span><strong>Отложить</strong><small>Вернуться позже</small></span></button></div>
      <button disabled={Boolean(pending)} onClick={() => save("DECLINED")} className="decline-link">Не выполнять эту работу</button>
      {error && <p className="form-error"><Icon name="alert" /> {error}</p>}
      <p className="security-note">Решение сохраняется один раз и привязано к этой защищённой ссылке.</p>
    </div>
  );
}
