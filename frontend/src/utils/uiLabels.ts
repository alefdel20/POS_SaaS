import type { Role, Reminder, Sale } from "../types";

const paymentMethodLabels: Record<Sale["payment_method"], string> = {
  cash: "efectivo",
  card: "tarjeta",
  credit: "credito / por pagar",
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
  "Request failed": "La solicitud fallo",
  "Invalid credentials": "Credenciales invalidas",
  "Authentication required": "Debes iniciar sesion",
  Forbidden: "No tienes permisos para entrar aqui",
  "Invalid session": "La sesion ya no es valida",
  "Invalid or expired token": "La sesion expiro",
  "Username or email already exists": "El usuario o correo ya existe",
  "Invalid role": "Rol invalido",
  "Forbidden role assignment": "No puedes asignar ese rol",
  "At least one active superusuario must remain": "Debe permanecer al menos un superusuario activo",
  "Product not found": "Producto no encontrado",
  "Supplier not found": "Proveedor no encontrado",
  "User not found": "Usuario no encontrado",
  "Customer name is required for credit sales": "El nombre del comprador es obligatorio para ventas a credito",
  "Customer phone is required for credit sales": "El telefono del comprador es obligatorio para ventas a credito",
  "Initial payment is required for credit sales": "El pago inicial es obligatorio para ventas a credito",
  "Credit sale not found": "La venta a credito no existe",
  "Payment amount must be greater than zero": "El abono debe ser mayor a cero",
  "Producto inactivo, contactar proveedor": "Producto inactivo, contactar proveedor",
  "Cannot permanently delete product with sales history": "No se puede eliminar definitivamente un producto con historial de ventas",
  "Discount configuration is incomplete": "La configuracion del remate esta incompleta",
  "Discount value must be positive": "El valor del remate debe ser positivo",
  "At least one product is required": "Debes seleccionar al menos un producto",
  "Telefono invalido para recordatorio": "No hay un telefono valido para enviar recordatorio",
  "Password must be at least 8 characters": "La contrasena debe tener al menos 8 caracteres",
  "Fiscal profile is incomplete": "Faltan datos fiscales en el perfil del negocio",
  "No invoice stamps available": "No hay timbres disponibles para facturar",
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
