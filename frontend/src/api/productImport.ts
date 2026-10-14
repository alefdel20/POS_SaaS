import { apiRequest } from "./client";
import type { ImportColumnMapResponse } from "../types";

// Clear Spanish message for each failure of POST /products/import/map-columns
// (backend: importColumnMapController.js); never the raw server or network text.
function mapColumnsErrorMessage(error: unknown): string {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : "";
  if (status === 403) {
    return /plan/i.test(message)
      ? "Mapear columnas con IA está disponible en el plan Premium o superior."
      : "Tu rol no puede usar el mapeo de columnas con IA.";
  }
  if (status === 429) {
    return /mensual/i.test(message)
      ? "Ya se usó la cuota mensual de IA de tu plan. Asigna las columnas a mano o espera al próximo mes."
      : "Demasiadas solicitudes de IA. Espera un momento e intenta de nuevo.";
  }
  if (status === 422) return "La IA no pudo proponer cómo asignar las columnas. Asígnalas a mano.";
  // 400: problems with the file itself (format, size, rows); those messages are Spanish.
  if (status === 400 && message) return message;
  return "El mapeo de columnas con IA no está disponible en este momento. Intenta más tarde o asigna las columnas a mano.";
}

// Reads only the headers and up to 5 sample rows on the server; writes nothing.
export async function apiMapImportColumns(token: string, file: File): Promise<ImportColumnMapResponse> {
  const formData = new FormData();
  formData.append("file", file);
  try {
    return await apiRequest<ImportColumnMapResponse>("/products/import/map-columns", {
      method: "POST",
      token,
      body: formData
    });
  } catch (error) {
    throw new Error(mapColumnsErrorMessage(error));
  }
}
