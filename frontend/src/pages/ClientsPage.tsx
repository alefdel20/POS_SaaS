import { ModuleShell } from "../components/ModuleShell";

export function ClientsPage() {
  return (
    <ModuleShell
      title="Clientes / Dueños"
      description="Base para administrar propietarios, datos de contacto y relación con pacientes."
      highlights={["Datos de contacto", "Vínculo con mascotas", "Historial comercial"]}
      nextStepLabel="Próximo crecimiento: CRUD de dueños y vínculo con pacientes."
    />
  );
}
