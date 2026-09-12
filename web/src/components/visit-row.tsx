import Link from "next/link";
import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/status-pill";
import { visitStatusMeta, type Visit } from "@/lib/domain";

export function VisitRow({ visit, compact = false }: { visit: Visit; compact?: boolean }) {
  const status = visitStatusMeta[visit.status];
  return (
    <Link href={`/visits/${visit.id}`} className={`visit-row ${compact ? "compact" : ""}`}>
      <span className="vehicle-icon"><Icon name="car" /></span>
      <span className="visit-main"><strong>{visit.vehicle}</strong><small>{visit.plate} · {visit.customer}</small></span>
      {!compact && <span className="visit-complaint">{visit.complaint}</span>}
      <span className="visit-state"><StatusPill label={status.label} tone={status.tone} /><small>{visit.updatedAt}</small></span>
      <Icon name="arrow-right" className="row-arrow" />
    </Link>
  );
}
