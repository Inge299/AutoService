"use client";
import { Button } from "@/components/action";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import type { ApprovalDecisionValue } from "@/lib/api/autoservice-api";
import { formatRub } from "@/lib/domain";

const labels: Record<ApprovalDecisionValue, { title: string; text: string; icon: IconName; tone: string }> = {
  APPROVED: { title: "Работа согласована", text: "Мастерская получила ваше решение и может продолжить ремонт.", icon: "check", tone: "success" },
  DECLINED: { title: "Работа отклонена", text: "Мастерская получила решение и не будет выполнять эту работу.", icon: "alert", tone: "danger" },
  DEFERRED: { title: "Работа отложена", text: "Рекомендация сохранена в истории автомобиля.", icon: "clock", tone: "neutral" },
  CALL_REQUESTED: { title: "Запрошен звонок", text: "Мастерская свяжется с вами, чтобы ответить на вопросы.", icon: "phone", tone: "warning" },
};

interface SavedDecision {
  value: ApprovalDecisionValue;
  createdAt: string;
}

export function ApprovalDecision({
  token,
  title,
  priceRub,
  initialDecision,
}: {
  token: string;
  title: string;
  priceRub: number;
  initialDecision: SavedDecision | null;
}) {
  const router = useRouter();
  const [savedDecision, setDecision] = useState<SavedDecision | null>(null);
  const decision = initialDecision ?? savedDecision;
  const [confirmation, setConfirmation] = useState<"APPROVED" | "DECLINED" | null>(null);
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
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (body.error === "decision_already_recorded") {
          router.refresh();
          throw new Error("По ссылке уже сохранено решение. Обновляем страницу, чтобы показать его.");
        }
        if (body.error === "visit_closed") throw new Error("Визит закрыт. Чтобы уточнить решение, свяжитесь с мастерской.");
        if (["link_unavailable", "not_found"].includes(body.error ?? "")) throw new Error("Ссылка недоступна. Свяжитесь с мастерской.");
        throw new Error("Не удалось сохранить решение. Проверьте связь и повторите.");
      }
      setDecision(await response.json() as SavedDecision);
      router.refresh();
    } catch (saveError) {
      router.refresh();
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить решение. Проверьте связь и повторите.");
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
    const result = labels[decision.value];
    return <div className={`decision-result decision-result-${result.tone}`}><span><Icon name={result.icon} /></span><h3>{result.title}</h3><p>{result.text}</p><small>{savedAt}</small></div>;
  }

  if (confirmation) return <div className="decision-panel">
    <h2>Подтвердите решение</h2>
    <p><strong>{title}</strong> · {formatRub(priceRub)}</p>
    <p>{confirmation === "APPROVED" ? "Вы разрешаете мастерской выполнить эту работу по указанной стоимости." : "Вы отказываетесь от выполнения этой работы."}</p>
    <Button disabled={Boolean(pending)} variant={confirmation === "APPROVED" ? "primary" : "danger"} onClick={() => save(confirmation)}>{pending ? "Сохраняем…" : "Подтвердить"}</Button>
    <Button disabled={Boolean(pending)} onClick={() => setConfirmation(null)}>Назад</Button>
    {error && <p role="alert" className="form-error"><Icon name="alert" /> {error}</p>}
  </div>;

  return (
    <div className="decision-panel">
      <h2>Ваше решение</h2><p>Выберите один вариант. После сохранения мастерская сразу увидит ответ.</p>
      <Button disabled={Boolean(pending)} onClick={() => { setError(null); setConfirmation("APPROVED"); }} variant="primary" className="decision-action"><Icon name="check" /><span><strong>{pending === "APPROVED" ? "Сохраняем…" : "Согласовать"}</strong><small>Выполнить работу за {formatRub(priceRub)}</small></span><Icon name="arrow-right" /></Button>
      <div className="secondary-decisions"><Button className="decision-action" disabled={Boolean(pending)} onClick={() => save("CALL_REQUESTED")}><Icon name="phone" /><span><strong>Нужен звонок</strong><small>Хочу уточнить детали</small></span></Button><Button className="decision-action" disabled={Boolean(pending)} onClick={() => save("DEFERRED")}><Icon name="clock" /><span><strong>Отложить</strong><small>Вернуться позже</small></span></Button></div>
      <Button disabled={Boolean(pending)} onClick={() => { setError(null); setConfirmation("DECLINED"); }} variant="danger" className="decision-decline">Не выполнять эту работу</Button>
      {error && <p role="alert" className="form-error"><Icon name="alert" /> {error}</p>}
    </div>
  );
}
