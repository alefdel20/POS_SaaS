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
  completed: "completado"
};

const roleLabels: Record<Role, string> = {
  superusuario: "superusuario",
  superadmin: "superadministrador",
  admin: "administrador",
  soporte: "soporte",
  support: "soporte",
  user: "cajero",
  cajero: "cajero",
  cashier: "cajero"
};

const errorTranslations: Record<string, string> = {
  "Request failed": "La solicitud falló",
  "Invalid credentials": "Credenciales inválidas",
  "Authentication required": "Debes iniciar sesión",
  Forbidden: "No tienes permisos para entrar aqui",
  "Invalid session": "La sesión ya no es válida",
  "Invalid or expired token": "La sesión expiró",
  "Username or email already exists": "El usuario o correo ya existe",
  "Invalid role": "Rol invalido",
  "Forbidden role assignment": "No puedes asignar ese rol",
  "At least one active superusuario must remain": "Debe permanecer al menos un superusuario activo",
  "Product not found": "Producto no encontrado",
  "Supplier not found": "Proveedor no encontrado",
  "Duplicate supplier assignment": "No puedes asignar el mismo proveedor dos veces al producto",
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
  "Reminder not found": "Recordatorio no encontrado"
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
