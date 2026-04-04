import { ModuleShell } from "../components/ModuleShell";

export function PatientsPage() {
  return (
    <ModuleShell
      title="Pacientes / Mascotas"
      description="Base para fichas clínicas de mascotas, especie, raza, edad y dueño responsable."
      highlights={["Ficha del paciente", "Especie y raza", "Responsable asociado"]}
      nextStepLabel="Próximo crecimiento: alta de pacientes y relación con consultas."
    />
  );
}
