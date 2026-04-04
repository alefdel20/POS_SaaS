import { ModuleShell } from "../components/ModuleShell";

export function MedicalConsultationsPage() {
  return (
    <ModuleShell
      title="Consultas médicas"
      description="Base para captura clínica, motivo de consulta, diagnóstico y tratamiento."
      highlights={["Motivo de consulta", "Diagnóstico", "Tratamiento y seguimiento"]}
      nextStepLabel="Próximo crecimiento: registro clínico completo y receta interna."
    />
  );
}
