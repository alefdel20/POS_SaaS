import { ReactNode } from "react";

export function StatCard({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <article className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value" style={accent ? { color: accent } : undefined}>
        {value}
      </strong>
    </article>
  );
}
