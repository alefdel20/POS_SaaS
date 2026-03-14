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
  superadmin: "superadministrador",
  admin: "administrador",
  user: "usuario",
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
  "Product not found": "Producto no encontrado",
  "User not found": "Usuario no encontrado"
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
