import type { Role, Reminder, Sale } from "../types";

const paymentMethodLabels: Record<Sale["payment_method"], string> = {
  cash: "efectivo",
  card: "tarjeta",
  credit: "crédito / por pagar",
  transfer: "transferencia"
};

const saleTypeLabels: Record<Sale["sale_type"], string> = {
  ticket: "ticket",
  invoice: "factura"
};

const reminderStatusLabels: Record<Reminder["status"], string> = {
  pending: "pendiente",
  in_progress: "en proceso",
  completed: "completado",
  cancelled: "cancelado"
};

const roleLabels: Record<Role, string> = {
  superusuario: "superusuario",
  superadmin: "superadministrador",
  admin: "administrador",
  clinico: "doctor",
  soporte: "soporte",
  support: "soporte",
  user: "cajero",
  cajero: "cajero",
  cashier: "cajero"
};

const errorTranslations: Record<string, string> = {
  "Request failed": "La solicitud falló",
  "Invalid credentials": "Credenciales inválidas",
  "Business already exists": "El negocio ya existe",
  "Business name is required": "El nombre del negocio es obligatorio",
  "Business type is required": "El tipo de negocio es obligatorio",
  "Business POS type is required": "El tipo de POS es obligatorio",
  "POS type is required when business type is Otro": "Debes especificar el tipo de POS cuando el negocio es Otro",
  "Invalid onboarding role": "Rol inválido para onboarding",
  "Authentication required": "Debes iniciar sesión",
  Forbidden: "No tienes permisos para entrar aqui",
  "Invalid session": "La sesión ya no es válida",
  "Invalid or expired token": "La sesión expiró",
  "Username or email already exists": "El usuario o correo ya existe",
  "Invalid role": "Rol invalido",
  "Forbidden role assignment": "No puedes asignar ese rol",
  "Cannot modify users from another business": "No puedes modificar usuarios de otro negocio",
  "At least one active superusuario must remain": "Debe permanecer al menos un superusuario activo",
  "Product not found": "Producto no encontrado",
  "Supplier not found": "Proveedor no encontrado",
  "Duplicate supplier assignment": "No puedes asignar el mismo proveedor dos veces al producto",
  "SKU already exists": "El SKU ya existe",
  "Barcode already exists": "El codigo de barras ya existe",
  "Unable to generate unique SKU": "No fue posible generar un SKU unico",
  "Product name is required": "El nombre del producto es obligatorio",
  "Product category is required": "La categoria del producto es obligatoria",
  "Product price must be greater than zero": "El precio de venta debe ser mayor a cero",
  "Product cost cannot be negative": "El costo no puede ser negativo",
  "Product stock cannot be negative": "El stock no puede ser negativo",
  "Product minimum stock cannot be negative": "El stock minimo no puede ser negativo",
  "Product maximum stock cannot be negative": "El stock maximo no puede ser negativo",
  "Product maximum stock cannot be lower than minimum stock": "El stock maximo no puede ser menor al stock minimo",
  "User not found": "Usuario no encontrado",
  "Cash received is required for cash sales": "Debes capturar el dinero recibido para ventas en efectivo",
  "Cash received must be greater than zero": "El dinero recibido debe ser mayor a cero",
  "Cash received must cover the sale total": "El dinero recibido debe cubrir el total de la venta",
  "Customer name is required for credit sales": "El nombre del comprador es obligatorio para ventas a crédito",
  "Customer phone is required for credit sales": "El teléfono del comprador es obligatorio para ventas a crédito",
  "Initial payment is required for credit sales": "El pago inicial es obligatorio para ventas a crédito",
  "Credit sale not found": "La venta a crédito no existe",
  "Payment amount must be greater than zero": "El abono debe ser mayor a cero",
  "Producto inactivo, contactar proveedor": "Producto inactivo, contactar proveedor",
  "Cannot permanently delete product with sales history": "No se puede eliminar definitivamente un producto con historial de ventas",
  "Discount configuration is incomplete": "La configuracion del remate esta incompleta",
  "Discount value must be positive": "El valor del remate debe ser positivo",
  "At least one product is required": "Debes seleccionar al menos un producto",
  "Telefono invalido para recordatorio": "No hay un teléfono válido para enviar recordatorio",
  "Password must be at least 8 characters": "La contraseña debe tener al menos 8 caracteres",
  "Fiscal profile is incomplete": "Faltan datos fiscales en el perfil del negocio",
  "No invoice stamps available": "No hay timbres disponibles para facturar",
  "Support mode requires an active user": "El modo soporte requiere un usuario activo",
  "Loan note is required": "La nota es obligatoria para movimientos de deuda del dueno",
  "Void reason is required": "Debes capturar un motivo de anulacion",
  "Expense not found": "Gasto no encontrado",
  "Void expense cannot be edited": "No puedes editar un gasto anulado",
  "Expense is already voided": "El gasto ya fue anulado",
  "Owner loan not found": "Movimiento del dueno no encontrado",
  "Owner loan is already voided": "El movimiento del dueno ya fue anulado",
  "Fixed expense not found": "Gasto fijo no encontrado",
  "Reminder not found": "Recordatorio no encontrado",
  "Preventive event not found": "Evento preventivo no encontrado",
  "Preventive event type is invalid": "El tipo de evento preventivo es invalido",
  "Preventive event status is invalid": "El estado del evento preventivo es invalido",
  "Patient weight is invalid": "El peso del paciente es invalido",
  "Prescription not found": "Receta no encontrada"
  ,"El doctor ya tiene una cita programada en ese horario": "El doctor ya tiene una cita programada en ese horario"
  ,"Request has already been resolved": "La solicitud ya fue procesada"
  ,"Feature schema is not ready": "La funcionalidad aun no esta lista en la base de datos"
};

export function getPaymentMethodLabel(value: Sale["payment_method"]) {
  return paymentMethodLabels[value];
}

export function getSaleTypeLabel(value: Sale["sale_type"]) {
  return saleTypeLabels[value];
}

export function getReminderStatusLabel(value: Reminder["status"]) {
  return reminderStatusLabels[value];
}

export function getRoleLabel(value?: Role | string | null) {
  if (!value) {
    return "-";
  }

  return roleLabels[value as Role] || value;
}

export function translateErrorMessage(message: string) {
  if (message.startsWith("Insufficient stock for ")) {
    const [, productName = "", stock = ""] = message.match(/^Insufficient stock for (.+)\. Current stock: (.+)$/) || [];
    return `Stock insuficiente para ${productName}. Stock actual: ${stock}`;
  }

  return errorTranslations[message] || message;
}
