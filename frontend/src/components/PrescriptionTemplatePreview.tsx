import { ReactNode } from "react";

// Static SVG mockups of each receta PDF template — not a render of the real
// PDF (no PDF-to-image tooling available in this environment), just a simple
// vector approximation of each layout's distribution/colors so the vet can
// tell them apart before picking one. Keep these in sync by eye with the
// pdfkit renderers in backend/src/services/clinicalService.js
// (renderClassicPrescription/renderModernPrescription/renderCompactPrescription/
// renderCustomPrescription) whenever those layouts change.
export type PrescriptionTemplateKey = "clasico" | "moderno" | "compacto" | "personalizado";

// Mirrors PRESCRIPTION_ACCENT_COLORS in clinicalService.js — keep in sync.
const ACCENT_COLORS: Record<string, string> = {
  default: "#1f9c82",
  ocean: "#2f82ff",
  forest: "#2f9e44",
  ember: "#e76f51"
};

function resolveAccentColor(accentPalette?: string) {
  return ACCENT_COLORS[accentPalette || "default"] || ACCENT_COLORS.default;
}

const PAGE_WIDTH = 120;
const PAGE_HEIGHT = 160;

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`} width="100%" height="100%" role="img" aria-hidden="true">
      <rect x="0.5" y="0.5" width={PAGE_WIDTH - 1} height={PAGE_HEIGHT - 1} fill="#ffffff" stroke="#d4d4d8" />
      {children}
    </svg>
  );
}

function TextLines({ x, y, width, count, gap = 7, color = "#9ca3af" }: { x: number; y: number; width: number; count: number; gap?: number; color?: string }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <rect key={index} x={x} y={y + index * gap} width={width} height={2.2} fill={color} rx={1} />
      ))}
    </>
  );
}

// Redesigned to mirror the printed-veterinary-receta structure of
// renderClassicPrescription: circular logo + business name with date at top
// right, a rounded patient-info box (two columns), a rounded Rp./Dx./Tx. box
// with separators, and a footer line for the doctors' cedulas.
function ClassicPreview() {
  return (
    <PageFrame>
      <circle cx={17} cy={17} r={7} fill="#e5e7eb" />
      <rect x={28} y={14} width={38} height={4} fill="#111827" rx={1} />
      <rect x={98} y={9} width={16} height={2.2} fill="#9ca3af" rx={1} />

      <rect x={8} y={30} width={104} height={38} rx={4} fill="none" stroke="#9ca3af" strokeWidth={0.75} />
      <TextLines x={12} y={36} width={40} count={4} gap={6.5} color="#6b7280" />
      <TextLines x={62} y={36} width={40} count={4} gap={6.5} color="#6b7280" />
      <rect x={12} y={62} width={4} height={4} fill="none" stroke="#6b7280" strokeWidth={0.6} />
      <rect x={20} y={62} width={4} height={4} fill="none" stroke="#6b7280" strokeWidth={0.6} />

      <rect x={8} y={74} width={104} height={46} rx={4} fill="none" stroke="#9ca3af" strokeWidth={0.75} />
      <rect x={12} y={79} width={10} height={3} fill="#374151" rx={0.5} />
      <TextLines x={26} y={80} width={80} count={2} gap={5} />
      <rect x={8} y={91} width={104} height={0.5} fill="#d4d4d8" />
      <rect x={12} y={95} width={10} height={3} fill="#374151" rx={0.5} />
      <TextLines x={26} y={96} width={80} count={1} gap={5} />
      <rect x={8} y={104} width={104} height={0.5} fill="#d4d4d8" />
      <rect x={12} y={108} width={10} height={3} fill="#374151" rx={0.5} />
      <TextLines x={26} y={109} width={80} count={1} gap={5} />

      <TextLines x={16} y={148} width={88} count={1} gap={5} color="#9ca3af" />
    </PageFrame>
  );
}

function ModernPreview({ accentColor }: { accentColor: string }) {
  return (
    <PageFrame>
      <rect x={0} y={0} width={PAGE_WIDTH} height={26} fill={accentColor} />
      <rect x={10} y={6} width={14} height={14} fill="#ffffff" opacity={0.85} />
      <rect x={30} y={9} width={45} height={4} fill="#ffffff" rx={1} />
      <rect x={10} y={35} width={28} height={3.2} fill={accentColor} rx={1} />
      <TextLines x={10} y={42} width={95} count={2} />
      <rect x={10} y={58} width={28} height={3.2} fill={accentColor} rx={1} />
      <TextLines x={10} y={65} width={95} count={2} />
      <rect x={10} y={82} width={100} height={1} fill={accentColor} />
      <rect x={10} y={88} width={30} height={3} fill={accentColor} rx={1} />
      <TextLines x={10} y={95} width={95} count={4} />
    </PageFrame>
  );
}

function CompactPreview() {
  return (
    <PageFrame>
      <rect x={6} y={6} width={10} height={10} fill="#e5e7eb" />
      <rect x={20} y={8} width={40} height={3.2} fill="#111827" rx={1} />
      <TextLines x={6} y={24} width={108} count={3} gap={5.5} />
      <rect x={6} y={44} width={26} height={3} fill="#374151" rx={1} />
      <TextLines x={6} y={51} width={108} count={12} gap={5} />
    </PageFrame>
  );
}

function CustomPreview() {
  return (
    <PageFrame>
      <rect x={1} y={1} width={PAGE_WIDTH - 2} height={PAGE_HEIGHT / 3} fill="#f3e8ff" stroke="#c4b5fd" strokeDasharray="3 2" />
      <text x={PAGE_WIDTH / 2} y={PAGE_HEIGHT / 6 + 3} textAnchor="middle" fontSize={6} fill="#7c3aed">
        Tu membrete
      </text>
      <TextLines x={10} y={PAGE_HEIGHT / 3 + 12} width={95} count={2} />
      <rect x={10} y={PAGE_HEIGHT / 3 + 28} width={28} height={3} fill="#374151" rx={1} />
      <TextLines x={10} y={PAGE_HEIGHT / 3 + 35} width={95} count={6} />
    </PageFrame>
  );
}

export function PrescriptionTemplatePreview({ template, accentPalette }: { template: PrescriptionTemplateKey; accentPalette?: string }) {
  if (template === "moderno") return <ModernPreview accentColor={resolveAccentColor(accentPalette)} />;
  if (template === "compacto") return <CompactPreview />;
  if (template === "personalizado") return <CustomPreview />;
  return <ClassicPreview />;
}
