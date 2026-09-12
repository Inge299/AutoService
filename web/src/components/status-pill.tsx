export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: string }) {
  return <span className={`status-pill status-${tone}`}>{label}</span>;
}
