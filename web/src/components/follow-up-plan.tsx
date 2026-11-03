"use client";

import { useActionState, useState } from "react";
import { saveFollowUp } from "@/app/(workshop)/customers/follow-up-actions";
import { Button } from "@/components/action";

function businessDate(value: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year:"numeric",month:"2-digit",day:"2-digit" }).format(value); }
function preset(months: number, days=0) {
  const now = new Date(`${businessDate(new Date())}T12:00:00Z`), day = now.getUTCDate();
  if (months) { now.setUTCDate(1); now.setUTCMonth(now.getUTCMonth()+months); const end = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).getUTCDate(); now.setUTCDate(Math.min(day,end)); }
  now.setUTCDate(now.getUTCDate()+days); return now.toISOString().slice(0,10);
}

export function FollowUpPlan({findingId, customerId, visitId, version, dueAt, state="OPEN", inherited=false}: {
  findingId:string; customerId?:string|null;visitId:string;version:number;dueAt:string|null;state?:"OPEN"|"DONE"|"CANCELLED";inherited?:boolean;
}) {
  const [date,setDate]=useState(dueAt?businessDate(new Date(dueAt)):"");
  const [result,action,pending]=useActionState(saveFollowUp,{});
  return <div className="follow-up-plan">
    <div className="follow-up-heading"><strong>{state==="DONE"?"Выполнено позже":state==="CANCELLED"?"Снято с плана":"План дальнейших работ"}</strong>
      {inherited && <span>Срок следующего визита</span>}</div>
    {state==="OPEN" && <p className="follow-up-current">{dueAt ? `Выполнить до ${new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",dateStyle:"long"}).format(new Date(dueAt))}` : "Срок пока не назначен"}</p>}
    <details className="follow-up-editor"><summary>{state==="OPEN" ? "Срок и выполнение" : "Изменить план"}</summary>
    <form action={action}>
      <input type="hidden" name="findingId" value={findingId}/><input type="hidden" name="customerId" value={customerId??""}/>
      <input type="hidden" name="visitId" value={visitId}/><input type="hidden" name="version" value={version}/>
      <label className="follow-up-date">Выполнить до<input type="date" name="dueAt" aria-label="Срок работы" value={date} onChange={event=>setDate(event.target.value)} disabled={pending}/></label>
      <div className="follow-up-presets" aria-label="Быстрый выбор срока">
        <button type="button" disabled={pending} onClick={()=>setDate(preset(0,14))}>2 недели</button>
        <button type="button" disabled={pending} onClick={()=>setDate(preset(1))}>Месяц</button>
        <button type="button" disabled={pending} onClick={()=>setDate(preset(3))}>3 месяца</button>
        <button type="button" disabled={pending} onClick={()=>setDate("")}>Без срока</button>
      </div>
      <div className="follow-up-actions">
        <Button name="intent" value="OPEN" type="submit" variant="primary" disabled={pending}>{pending?"Сохраняем…":state==="OPEN"?"Сохранить срок":"Вернуть в план"}</Button>
        {state==="OPEN" && <Button name="intent" value="DONE" type="submit" disabled={pending}>Выполнено</Button>}
      </div>
      {state==="OPEN" && <details className="follow-up-other"><summary>Другие действия</summary><p>Снять работу с плана и отменить ожидающее напоминание. История сохранится.</p><Button name="intent" value="CANCELLED" type="submit" disabled={pending}>Снять с плана</Button></details>}
      {result.error && <p role="alert" className="follow-up-error">{result.error}</p>}
      {result.success && <p role="status" className="follow-up-success">{result.success}</p>}
    </form>
    </details>
    <small>Изменения плана не переписывают ранее опубликованный отчёт.</small>
  </div>;
}
