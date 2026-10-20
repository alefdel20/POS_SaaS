// test-email.js — script DESECHABLE, no se commitea.
// Envía los correos de emailService.js con datos de prueba SOLO a la dirección del argumento.
// No toca BD, Openpay, webhooks ni pending_onboardings: solo carga env + nodemailer + emailService.
//
// Uso (dentro del contenedor, cwd /app):
//   node scripts/test-email.js tu@correo.com            -> envía los 8 correos
//   node scripts/test-email.js tu@correo.com spei,reset -> solo los indicados
//
// Claves válidas: welcome, trial, failed, confirmation, spei, reset, cancellation, reactivation

require("dotenv").config();

const nodemailer = require("nodemailer");

const target = String(process.argv[2] || "").trim().toLowerCase();
if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(target)) {
  console.error("Uso: node scripts/test-email.js <correo-destino> [claves,separadas,por,coma]");
  process.exit(1);
}

// Guard: se intercepta createTransport ANTES de cargar emailService. Cualquier sendMail cuyo
// destinatario no sea exactamente `target` (o que traiga cc/bcc) se bloquea y no sale.
// Esto evita, p. ej., la notificación interna de compra que sendWelcomeEmail manda a ankodemx@gmail.com.
const results = [];
const originalCreateTransport = nodemailer.createTransport.bind(nodemailer);
nodemailer.createTransport = (...args) => {
  const transporter = originalCreateTransport(...args);
  const originalSendMail = transporter.sendMail.bind(transporter);
  transporter.sendMail = async (mail = {}) => {
    const to = String(mail.to || "").trim().toLowerCase();
    if (to !== target || mail.cc || mail.bcc) {
      console.warn(`  [BLOQUEADO] "${mail.subject}" iba a ${mail.to || "(vacío)"} — no se envía`);
      results.push({ subject: mail.subject, status: "bloqueado" });
      return { blocked: true };
    }
    const subject = `[PRUEBA] ${mail.subject || ""}`;
    try {
      const info = await originalSendMail({ ...mail, subject });
      results.push({ subject, status: "enviado", messageId: info && info.messageId });
      return info;
    } catch (error) {
      results.push({ subject, status: "error", error: error.message });
      throw error;
    }
  };
  return transporter;
};

const emailService = require("../src/services/emailService");

const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

const cases = {
  welcome: () => emailService.sendWelcomeEmail(target, {
    businessName: "Negocio de Prueba", ownerName: "Usuario Prueba", email: target, planName: "Plan Prueba", amount: 1
  }),
  trial: () => emailService.sendTrialWelcomeEmail(target, {
    businessName: "Negocio de Prueba", ownerName: "Usuario Prueba", email: target,
    trialStartDate: new Date(now), trialEndDate: new Date(now + 14 * day)
  }),
  failed: () => emailService.sendPaymentFailedEmail(target, {
    businessName: "Negocio de Prueba", ownerName: "Usuario Prueba", amount: 1, currency: "MXN"
  }),
  confirmation: () => emailService.sendPaymentConfirmationEmail(target, {
    name: "Usuario Prueba", amount: 1, currency: "MXN", method: "prueba"
  }),
  spei: () => emailService.sendSpeiInstructionsEmail(target, {
    name: "Usuario Prueba", amount: 1, currency: "MXN", clabe: "000000000000000000 (PRUEBA)",
    bank_name: "BANCO DE PRUEBA", due_date: new Date(now + 3 * day), plan_name: "Plan Prueba"
  }),
  reset: () => emailService.sendPasswordResetEmail(
    target, `${frontendUrl}/reset-password?token=PRUEBA-TOKEN-INVALIDO`, "Usuario Prueba"
  ),
  cancellation: () => emailService.sendCancellationEmail(target, {
    businessName: "Negocio de Prueba", ownerName: "Usuario Prueba", accessUntil: new Date(now + 30 * day)
  }),
  reactivation: () => emailService.sendReactivationEmail(target, {
    businessName: "Negocio de Prueba", ownerName: "Usuario Prueba", nextPaymentDate: new Date(now + 30 * day)
  })
};

const requested = process.argv[3]
  ? process.argv[3].split(",").map((k) => k.trim()).filter(Boolean)
  : Object.keys(cases);
const unknown = requested.filter((k) => !cases[k]);
if (unknown.length) {
  console.error(`Claves desconocidas: ${unknown.join(", ")}. Válidas: ${Object.keys(cases).join(", ")}`);
  process.exit(1);
}

(async () => {
  console.log(`Destino único: ${target}`);
  for (const key of requested) {
    console.log(`→ ${key}`);
    try {
      await cases[key]();
    } catch (error) {
      // Solo sendSpeiInstructionsEmail lanza; las demás capturan y loguean internamente.
      console.error(`  [ERROR] ${key}: ${error.message}`);
    }
  }

  console.log("\nResumen:");
  results.forEach((r) => {
    console.log(`  ${r.status.padEnd(9)} ${r.subject}${r.error ? ` — ${r.error}` : ""}`);
  });

  console.log("\nConfiguración SMTP (sin credenciales):");
  console.log(`  EMAIL_FROM = ${process.env.EMAIL_FROM ? process.env.EMAIL_FROM : '(no definido → fallback "noreply@ankode.mx")'}`);
  console.log(`  EMAIL_HOST = ${process.env.EMAIL_HOST || "(no definido)"}`);
  console.log(`  EMAIL_PORT = ${process.env.EMAIL_PORT || "(no definido → 587)"}`);
  console.log(`  EMAIL_USER = ${process.env.EMAIL_USER ? "(definido)" : "(no definido)"}`);
  console.log(`  EMAIL_PASS = ${process.env.EMAIL_PASS ? "(definido)" : "(no definido)"}`);
  console.log(`  FRONTEND_URL = ${frontendUrl}`);

  process.exit(results.some((r) => r.status === "error") ? 1 : 0);
})();
