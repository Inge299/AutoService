import { Button } from "@/components/action";
import { Icon } from "@/components/icons";

export function ListSearch({ query, placeholder, status }: { query?: string; placeholder: string; status?: string }) {
  return <form className="list-search"><label className="search-field"><Icon name="search" /><input aria-label="Поиск" name="q" defaultValue={query} placeholder={placeholder} /></label>{status && <input type="hidden" name="status" value={status} />}<Button type="submit">Найти</Button></form>;
}
