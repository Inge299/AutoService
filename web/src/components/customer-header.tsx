import { BrandMark, Icon } from "@/components/icons";
import { ActionLink } from "@/components/action";

export function CustomerHeader({ phone }: { phone?: string | null }) {
  return <header className="customer-header"><BrandMark /><nav aria-label="Действия клиента" className="customer-header-actions">
    {phone && <ActionLink href={`tel:${phone.replace(/[^+\d]/g, "")}`}><Icon name="phone" /><span>Позвонить</span></ActionLink>}
    <ActionLink href="/cabinet">Личный кабинет</ActionLink>
  </nav></header>;
}
