import { Button } from "@/components/action";
import { Icon } from "@/components/icons";

export function ListSearch({ query, placeholder, status, label = "Поиск" }: { query?: string; placeholder: string; status?: string; label?: string }) {
  return <form className="list-search" role="search" aria-label={label}><label className="search-field"><Icon name="search" /><input aria-label={placeholder} name="q" defaultValue={query} placeholder={placeholder} /></label>{status && <input type="hidden" name="status" value={status} />}<Button type="submit">Найти</Button></form>;
}
