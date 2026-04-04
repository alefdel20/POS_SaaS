import { ModuleShell } from "../components/ModuleShell";

export function MedicalHistoryPage() {
  return (
    <ModuleShell
      title="Historial médico"
      description="Vista base consolidada para evolución clínica y consultas previas por paciente."
      highlights={["Línea de tiempo clínica", "Consultas previas", "Tratamientos registrados"]}
      nextStepLabel="Próximo crecimiento: historial clínico consolidado por mascota."
    />
  );
}
