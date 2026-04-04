import { ModuleShell } from "../components/ModuleShell";

export function MedicalAppointmentsPage() {
  return (
    <ModuleShell
      title="Citas médicas"
      description="Base para agenda de atención clínica, seguimiento y orden operativo del día."
      highlights={["Agenda diaria", "Estado de cita", "Paciente y responsable"]}
      nextStepLabel="Próximo crecimiento: calendario y confirmación de citas."
    />
  );
}
