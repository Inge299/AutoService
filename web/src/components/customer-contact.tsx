import { Icon } from "@/components/icons";

export function CustomerContact({ phone }: { phone: string | null }) {
  if (!phone) return null;
  return <div className="customer-help"><Icon name="phone" /><p><strong>Остались вопросы?</strong><small>Позвоните в мастерскую: <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a>.</small></p></div>;
}
