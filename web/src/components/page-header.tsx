export function PageHeader({ title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
