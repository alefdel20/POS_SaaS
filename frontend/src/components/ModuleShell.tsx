type ModuleShellProps = {
  title: string;
  description: string;
  highlights: string[];
  nextStepLabel: string;
};

export function ModuleShell({ title, description, highlights, nextStepLabel }: ModuleShellProps) {
  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{title}</h2>
            <p className="muted">{description}</p>
          </div>
        </div>
        <div className="module-shell-grid">
          {highlights.map((highlight) => (
            <div className="info-card" key={highlight}>
              <h3>{highlight}</h3>
              <p className="muted">Base visible y lista para crecer sin romper la vertical actual.</p>
            </div>
          ))}
        </div>
        <div className="empty-state-card">
          <strong>{nextStepLabel}</strong>
          <p className="muted">Este módulo ya quedó integrado en navegación y listo para recibir lógica clínica en la siguiente fase.</p>
        </div>
      </div>
    </section>
  );
}
