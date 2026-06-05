// emailService.js
// Requires: npm install nodemailer
// Required env vars: EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM, FRONTEND_URL

const nodemailer = require("nodemailer");

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: Number(process.env.EMAIL_PORT) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

function getEmailFrom() { return process.env.EMAIL_FROM || "noreply@ankode.mx"; }
function getFrontendUrl() { return process.env.FRONTEND_URL || "http://localhost:5173"; }

// ---------------------------------------------------------------------------
// sendWelcomeEmail
// Called after a business is automatically provisioned following a payment.
// data: { businessName, ownerName, email, tempPassword }
// Never throws — email failure must never crash the onboarding flow.
// ---------------------------------------------------------------------------

async function sendWelcomeEmail(to, data = {}) {
  console.log(`[EMAIL] Attempting to send to: ${to}`);
  const { businessName = "", ownerName = "", email = "", planName = "", amount = "" } = data;
  const EMAIL_FROM = getEmailFrom();
  const loginUrl = `${getFrontendUrl()}/login`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>¡Bienvenido a Ankode!</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
    .header { background: #7c3aed; padding: 32px 40px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 26px; letter-spacing: -0.5px; }
    .header p { color: #ede9fe; margin: 6px 0 0; font-size: 14px; }
    .body { padding: 32px 40px; color: #1e293b; font-size: 15px; line-height: 1.7; }
    .card { background: #f1f5f9; border-left: 4px solid #7c3aed; border-radius: 6px; padding: 18px 22px; margin: 22px 0; }
    .card p { margin: 6px 0; font-size: 14px; color: #1e293b; }
    .card strong { color: #7c3aed; }
    .btn { display: inline-block; margin: 24px 0 0; padding: 13px 32px; background: #4ade80; color: #0f172a !important; text-decoration: none; border-radius: 7px; font-size: 15px; font-weight: bold; }
    .note { margin-top: 20px; font-size: 13px; color: #64748b; }
    .footer { padding: 20px 40px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Ankode</h1>
      <p>Sistema de punto de venta para tu negocio</p>
    </div>
    <div class="body">
      <p>¡Bienvenido a Ankode, <strong>${ownerName || email}</strong>!</p>
      <p>Gracias por contratar Ankode. Tu cuenta está lista para comenzar.</p>
      <div class="card">
        <p><strong>Negocio:</strong> ${businessName}</p>
        ${planName ? `<p><strong>Plan:</strong> ${planName}</p>` : ""}
        <p><strong>Usuario:</strong> ${email || to}</p>
        <p><strong>Contraseña:</strong> la misma que registraste al contratar</p>
      </div>
      <a class="btn" href="${loginUrl}">Acceder a Ankode</a>
      <p style="margin-top:18px; font-size:13px; color:#64748b;">
        Si el botón no funciona, copia este enlace:<br />
        <a href="${loginUrl}" style="color:#7c3aed;">${loginUrl}</a>
      </p>
      <p class="note">Por seguridad, te recomendamos cambiar tu contraseña en tu primer inicio de sesión.</p>
    </div>
    <div class="footer">
      © Ankode · ankode.cloud · contacto@ankode.cloud
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = [
    `¡Bienvenido a Ankode, ${ownerName || email}!`,
    ``,
    `Gracias por contratar Ankode. Tu cuenta está lista para comenzar.`,
    ``,
    `Datos de acceso:`,
    `  Negocio: ${businessName}`,
    planName ? `  Plan: ${planName}` : "",
    `  Usuario: ${email || to}`,
    `  Contraseña: la misma que registraste al contratar`,
    ``,
    `Accede en: ${loginUrl}`,
    ``,
    `Por seguridad, te recomendamos cambiar tu contraseña en tu primer inicio de sesión.`
  ].filter((l) => l !== undefined).join("\n");

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject: "¡Bienvenido a Ankode! Tu cuenta está lista",
      html,
      text
    });
    console.info(`[EMAIL] Welcome email sent to ${to} for business "${businessName}"`);
  } catch (error) {
    console.error("[EMAIL] Error sending welcome email:", error.message);
  }

  // Notificación interna de nueva compra
  try {
    const transporter = createTransporter();
    const fecha = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: "ankodemx@gmail.com",
      subject: `Nueva compra — ${planName || "Plan"}`,
      text: [
        `Nueva compra en Ankode`,
        ``,
        `Cliente: ${email || to}`,
        `Plan: ${planName || "—"}`,
        `Monto: $${amount ? Number(amount).toFixed(2) : "—"} MXN`,
        `Fecha: ${fecha}`
      ].join("\n")
    });
    console.info(`[EMAIL] Admin purchase notification sent for ${to}`);
  } catch (error) {
    console.error(`[EMAIL] Failed to send admin purchase notification:`, error.message);
  }
}

// ---------------------------------------------------------------------------
// sendTrialWelcomeEmail
// Sent when a new trial business is created (authService / businessService).
// data: { businessName, ownerName, email, trialStartDate, trialEndDate }
// Never throws.
// ---------------------------------------------------------------------------

async function sendTrialWelcomeEmail(to, data = {}) {
  const { businessName = "", ownerName = "", email = "", trialStartDate, trialEndDate } = data;
  const EMAIL_FROM = getEmailFrom();
  const loginUrl = `${getFrontendUrl()}/login`;

  const fmtDate = (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });
  };

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>¡Tu prueba gratuita de Ankode está activa!</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
    .header { background: #7c3aed; padding: 32px 40px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 26px; letter-spacing: -0.5px; }
    .header p { color: #ede9fe; margin: 6px 0 0; font-size: 14px; }
    .body { padding: 32px 40px; color: #1e293b; font-size: 15px; line-height: 1.7; }
    .card { background: #f1f5f9; border-left: 4px solid #7c3aed; border-radius: 6px; padding: 18px 22px; margin: 22px 0; }
    .card p { margin: 6px 0; font-size: 14px; color: #1e293b; }
    .card strong { color: #7c3aed; }
    .btn { display: inline-block; margin: 24px 0 0; padding: 13px 32px; background: #4ade80; color: #0f172a !important; text-decoration: none; border-radius: 7px; font-size: 15px; font-weight: bold; }
    .footer { padding: 20px 40px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Ankode</h1>
      <p>Tu prueba gratuita está activa</p>
    </div>
    <div class="body">
      <p>¡Hola, <strong>${ownerName || email}</strong>!</p>
      <p>Tu negocio <strong>${businessName}</strong> ya está listo para usar Ankode durante tu período de prueba gratuita.</p>
      <div class="card">
        <p><strong>Inicio de prueba:</strong> ${fmtDate(trialStartDate)}</p>
        <p><strong>Fin de prueba:</strong> ${fmtDate(trialEndDate)}</p>
        <p><strong>Usuario:</strong> ${email || to}</p>
        <p><strong>Contraseña:</strong> la misma que registraste al crear tu cuenta</p>
      </div>
      <p>Explora todas las funcionalidades y, si tienes dudas, escríbenos.</p>
      <a class="btn" href="${loginUrl}">Comenzar ahora</a>
      <p style="margin-top:18px; font-size:13px; color:#64748b;">
        Si el botón no funciona, copia este enlace:<br />
        <a href="${loginUrl}" style="color:#7c3aed;">${loginUrl}</a>
      </p>
    </div>
    <div class="footer">
      © Ankode · ankode.cloud · contacto@ankode.cloud
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = [
    `¡Tu prueba gratuita de Ankode está activa!`,
    ``,
    `Hola ${ownerName || email},`,
    `Tu negocio "${businessName}" ya está listo en Ankode.`,
    ``,
    `  Inicio de prueba: ${fmtDate(trialStartDate)}`,
    `  Fin de prueba: ${fmtDate(trialEndDate)}`,
    `  Usuario: ${email || to}`,
    `  Contraseña: la misma que registraste al crear tu cuenta`,
    ``,
    `Accede en: ${loginUrl}`
  ].join("\n");

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject: "¡Tu prueba gratuita de Ankode está activa!",
      html,
      text
    });
    console.info(`[EMAIL] Trial welcome email sent to ${to} for business "${businessName}"`);
  } catch (error) {
    console.error(`[EMAIL] Failed to send trial welcome email to ${to}:`, error.message);
  }
}

// ---------------------------------------------------------------------------
// sendPaymentFailedEmail
// Called after a charge.failed or subscription.charge.failed event.
// data: { businessName, ownerName, amount, currency }
// Never throws.
// ---------------------------------------------------------------------------

async function sendPaymentFailedEmail(to, data = {}) {
  const { businessName = "", ownerName = "", amount = "", currency = "MXN" } = data;
  const EMAIL_FROM = getEmailFrom();
  const loginUrl = `${getFrontendUrl()}/login`;

  const amountText = amount ? `$${Number(amount).toFixed(2)} ${currency}` : "";

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Problema con tu pago en Ankode</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; }
    .header { background: #dc2626; padding: 32px 40px; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; }
    .body { padding: 32px 40px; color: #333; font-size: 15px; line-height: 1.6; }
    .alert { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
    .btn { display: inline-block; margin: 24px 0 0; padding: 12px 28px; background: #dc2626; color: #fff !important; text-decoration: none; border-radius: 6px; font-size: 15px; font-weight: bold; }
    .footer { padding: 20px 40px; font-size: 12px; color: #888; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Hubo un problema con tu pago</h1>
    </div>
    <div class="body">
      <p>Hola <strong>${ownerName || to}</strong>,</p>
      <p>No pudimos procesar tu pago${amountText ? ` de <strong>${amountText}</strong>` : ""} para activar el negocio <strong>${businessName || "en Ankode"}</strong>.</p>
      <div class="alert">
        <p>Es posible que tu tarjeta haya sido rechazada o que haya ocurrido un error en el procesador de pagos.</p>
        <p>No se realizó ningún cargo a tu cuenta.</p>
      </div>
      <p>Por favor intenta de nuevo o contacta a tu banco para más información.</p>
      <a class="btn" href="${loginUrl}">Intentar de nuevo</a>
    </div>
    <div class="footer">
      ¿Necesitas ayuda? Escríbenos a soporte@ankode.mx
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = [
    `Hubo un problema con tu pago en Ankode`,
    ``,
    `Hola ${ownerName || to},`,
    `No pudimos procesar tu pago${amountText ? ` de ${amountText}` : ""} para el negocio "${businessName}".`,
    `No se realizó ningún cargo.`,
    ``,
    `Por favor intenta de nuevo en: ${loginUrl}`,
    `O contacta a soporte@ankode.mx`
  ].join("\n");

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject: "Hubo un problema con tu pago en Ankode",
      html,
      text
    });
    console.info(`[EMAIL] Payment failed email sent to ${to}`);
  } catch (error) {
    console.error(`[EMAIL] Failed to send payment failed email to ${to}:`, error.message);
  }
}

// ---------------------------------------------------------------------------
// sendPaymentConfirmationEmail
// Sent after charge.succeeded (existing business) or spei.received.
// data: { name, amount, currency, method }
// Never throws.
// ---------------------------------------------------------------------------

async function sendPaymentConfirmationEmail(to, data = {}) {
  const { name = "", amount = 0, currency = "MXN", method = "tarjeta" } = data;
  const EMAIL_FROM = getEmailFrom();
  const fecha = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
  const amountText = `$${Number(amount).toFixed(2)} ${currency}`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Confirmación de pago — Ankode</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; }
    .header { background: #0d9488; padding: 32px 40px; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; }
    .body { padding: 32px 40px; color: #333; font-size: 15px; line-height: 1.6; }
    .detail { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
    .detail p { margin: 6px 0; }
    .detail strong { color: #0d9488; }
    .footer { padding: 20px 40px; font-size: 12px; color: #888; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Pago confirmado ✓</h1>
    </div>
    <div class="body">
      <p>Hola <strong>${name || to}</strong>,</p>
      <p>Tu pago en Ankode fue procesado correctamente.</p>
      <div class="detail">
        <p><strong>Monto:</strong> ${amountText}</p>
        <p><strong>Método:</strong> ${method}</p>
        <p><strong>Fecha:</strong> ${fecha}</p>
      </div>
      <p>Gracias por confiar en Ankode.</p>
    </div>
    <div class="footer">
      ¿Dudas? Escríbenos a soporte@ankode.mx
    </div>
  </div>
</body>
</html>`.trim();

  const text = [
    `Pago confirmado — Ankode`,
    ``,
    `Hola ${name || to},`,
    `Tu pago de ${amountText} fue procesado correctamente vía ${method}.`,
    `Fecha: ${fecha}`,
    ``,
    `Gracias por confiar en Ankode.`,
    `¿Dudas? soporte@ankode.mx`
  ].join("\n");

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject: "Confirmación de pago — Ankode",
      html,
      text
    });
    console.info(`[EMAIL] Payment confirmation sent to ${to}`);
  } catch (error) {
    console.error("[EMAIL] Error sending payment confirmation:", error);
  }
}

// ---------------------------------------------------------------------------
// sendSpeiInstructionsEmail
// Sent immediately after a SPEI charge is created, before payment is received.
// data: { name, amount, currency, clabe, bank_name, due_date, plan_name }
// ---------------------------------------------------------------------------

async function sendSpeiInstructionsEmail(to, data = {}) {
  const { name, amount, currency, clabe, bank_name, due_date, plan_name } = data;
  const transporter = createTransporter();
  const from = getEmailFrom();
  const amountFormatted = Number(amount || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
  const dueDateFormatted = due_date
    ? new Date(due_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px;">
      <div style="background:#6d4aff;padding:24px;border-radius:8px;text-align:center;margin-bottom:24px;">
        <h1 style="color:white;margin:0;font-size:24px;">Instrucciones de pago SPEI</h1>
      </div>
      <p style="color:#374151;font-size:16px;">Hola <strong>${name || to}</strong>,</p>
      <p style="color:#374151;">Tu orden de suscripción <strong>${plan_name || 'Ankode POS'}</strong> ha sido generada. Realiza la transferencia SPEI con los siguientes datos:</p>
      <div style="background:white;border:2px solid #e5e7eb;border-radius:8px;padding:24px;margin:20px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:10px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #f3f4f6;">Banco receptor</td><td style="padding:10px 0;font-weight:700;text-align:right;">${bank_name || 'OPENBANK'}</td></tr>
          <tr><td style="padding:10px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #f3f4f6;">CLABE</td><td style="padding:10px 0;font-weight:700;font-family:monospace;font-size:16px;text-align:right;color:#6d4aff;">${clabe || '—'}</td></tr>
          <tr><td style="padding:10px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #f3f4f6;">Monto</td><td style="padding:10px 0;font-weight:700;text-align:right;color:#6d4aff;">$${amountFormatted} ${currency || 'MXN'}</td></tr>
          <tr><td style="padding:10px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #f3f4f6;">Concepto</td><td style="padding:10px 0;font-weight:700;text-align:right;">${plan_name || 'Ankode POS'}</td></tr>
          ${dueDateFormatted ? `<tr><td style="padding:10px 0;color:#6b7280;font-size:14px;">Fecha límite</td><td style="padding:10px 0;font-weight:700;text-align:right;color:#ef4444;">${dueDateFormatted}</td></tr>` : ''}
        </table>
      </div>
      <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0;color:#92400e;font-size:14px;">⚠️ <strong>Importante:</strong> Usa exactamente el monto indicado. Tu suscripción se activará automáticamente al detectarse el pago.</p>
      </div>
      <p style="color:#6b7280;font-size:13px;margin-top:24px;">¿Tienes dudas? Escríbenos a <a href="mailto:ankodemx@gmail.com" style="color:#6d4aff;">ankodemx@gmail.com</a></p>
    </div>
  `;

  await transporter.sendMail({ from, to, subject: `Instrucciones de pago SPEI — ${plan_name || 'Ankode POS'}`, html });
}

// ---------------------------------------------------------------------------
// sendPasswordResetEmail
// Called after a self-service forgot-password request.
// Never throws — email failure is logged but does not expose user existence.
// ---------------------------------------------------------------------------

async function sendPasswordResetEmail(to, resetLink, userName = "") {
  const EMAIL_FROM = getEmailFrom();
  const greeting = userName ? `Hola, <strong>${userName}</strong>` : "Hola";

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Recupera tu contraseña — Ankode</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
    .header { background: #7c3aed; padding: 32px 40px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 26px; letter-spacing: -0.5px; }
    .header p { color: #ede9fe; margin: 6px 0 0; font-size: 14px; }
    .body { padding: 32px 40px; color: #1e293b; font-size: 15px; line-height: 1.7; }
    .card { background: #f1f5f9; border-left: 4px solid #7c3aed; border-radius: 6px; padding: 18px 22px; margin: 22px 0; font-size: 14px; color: #475569; }
    .btn { display: inline-block; margin: 24px 0 0; padding: 13px 32px; background: #4ade80; color: #0f172a !important; text-decoration: none; border-radius: 7px; font-size: 15px; font-weight: bold; }
    .note { margin-top: 20px; font-size: 13px; color: #64748b; }
    .footer { padding: 20px 40px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Ankode</h1>
      <p>Recuperación de contraseña</p>
    </div>
    <div class="body">
      <p>${greeting},</p>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en Ankode.</p>
      <div class="card">
        El enlace es válido por <strong>1 hora</strong>. Si no lo usas, tu contraseña no cambiará.
      </div>
      <a class="btn" href="${resetLink}">Restablecer contraseña</a>
      <p style="margin-top:18px; font-size:13px; color:#64748b;">
        Si el botón no funciona, copia este enlace:<br />
        <a href="${resetLink}" style="color:#7c3aed;">${resetLink}</a>
      </p>
      <p class="note">Si no solicitaste este cambio, puedes ignorar este correo. Tu cuenta está segura.</p>
    </div>
    <div class="footer">
      © Ankode · ankode.cloud · contacto@ankode.cloud
    </div>
  </div>
</body>
</html>`.trim();

  const text = [
    `Recupera tu contraseña — Ankode`,
    ``,
    userName ? `Hola, ${userName}` : "Hola",
    ``,
    `Recibimos una solicitud para restablecer la contraseña de tu cuenta.`,
    `El enlace es válido por 1 hora.`,
    ``,
    resetLink,
    ``,
    `Si no solicitaste este cambio, ignora este correo. Tu cuenta está segura.`
  ].join("\n");

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject: "Recupera tu contraseña — Ankode",
      html,
      text
    });
    console.info(`[EMAIL] Password reset email sent to ${to}`);
  } catch (error) {
    console.error(`[EMAIL] Failed to send password reset email to ${to}:`, error.message);
  }
}

// ---------------------------------------------------------------------------
// sendCancellationEmail
// Sent after a subscription is cancelled (user-initiated or via webhook).
// data: { businessName, ownerName, accessUntil }
// Never throws.
// ---------------------------------------------------------------------------

async function sendCancellationEmail(to, data = {}) {
  const { businessName = "", ownerName = "", accessUntil = null } = data;
  const EMAIL_FROM = getEmailFrom();
  const frontendUrl = getFrontendUrl();
  const accessText = accessUntil
    ? new Date(accessUntil).toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Mexico_City" })
    : null;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tu suscripción de Ankode ha sido cancelada</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; }
    .header { background: #64748b; padding: 32px 40px; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; }
    .body { padding: 32px 40px; color: #333; font-size: 15px; line-height: 1.6; }
    .info { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
    .info p { margin: 6px 0; }
    .btn { display: inline-block; margin: 24px 0 0; padding: 12px 28px; background: #0d9488; color: #fff !important; text-decoration: none; border-radius: 6px; font-size: 15px; font-weight: bold; }
    .footer { padding: 20px 40px; font-size: 12px; color: #888; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Tu suscripción ha sido cancelada</h1>
    </div>
    <div class="body">
      <p>Hola <strong>${ownerName || to}</strong>,</p>
      <p>Tu suscripción de Ankode para el negocio <strong>${businessName || "tu cuenta"}</strong> ha sido cancelada.</p>
      ${accessText ? `
      <div class="info">
        <p>Tu acceso al sistema continuará activo hasta el <strong>${accessText}</strong>.</p>
        <p>Después de esa fecha, el acceso será suspendido.</p>
      </div>` : ""}
      <p>Si deseas reactivar tu suscripción, puedes hacerlo en cualquier momento desde nuestro sitio.</p>
      <a class="btn" href="${frontendUrl}">Reactivar mi cuenta</a>
      <p style="margin-top:24px; font-size:13px; color:#555;">
        ¿Necesitas ayuda? Contáctanos en <a href="mailto:soporte@ankode.mx">soporte@ankode.mx</a>
      </p>
    </div>
    <div class="footer">
      Este correo fue generado automáticamente. Gracias por haber confiado en Ankode.
    </div>
  </div>
</body>
</html>`.trim();

  const text = [
    `Tu suscripción de Ankode ha sido cancelada`,
    ``,
    `Hola ${ownerName || to},`,
    `Tu suscripción para el negocio "${businessName}" ha sido cancelada.`,
    accessText ? `Tu acceso continuará hasta el ${accessText}.` : "",
    ``,
    `Para reactivar tu cuenta visita: ${frontendUrl}`,
    `¿Dudas? soporte@ankode.mx`
  ].filter(Boolean).join("\n");

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject: "Tu suscripción de Ankode ha sido cancelada",
      html,
      text
    });
    console.info(`[EMAIL] Cancellation email sent to ${to}`);
  } catch (error) {
    console.error(`[EMAIL] Failed to send cancellation email to ${to}:`, error.message);
  }
}

// ---------------------------------------------------------------------------
// sendReactivationEmail
// Sent after a cancelled subscription is reactivated via a new payment.
// data: { businessName, ownerName, nextPaymentDate }
// Never throws.
// ---------------------------------------------------------------------------

async function sendReactivationEmail(to, data = {}) {
  const { businessName = "", ownerName = "", nextPaymentDate = null } = data;
  const EMAIL_FROM = getEmailFrom();
  const loginUrl = `${getFrontendUrl()}/login`;
  const nextPaymentText = nextPaymentDate
    ? new Date(nextPaymentDate).toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Mexico_City" })
    : null;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>¡Tu cuenta de Ankode ha sido reactivada!</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; }
    .header { background: #0d9488; padding: 32px 40px; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; }
    .body { padding: 32px 40px; color: #333; font-size: 15px; line-height: 1.6; }
    .detail { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
    .detail p { margin: 6px 0; }
    .detail strong { color: #0d9488; }
    .btn { display: inline-block; margin: 24px 0 0; padding: 12px 28px; background: #0d9488; color: #fff !important; text-decoration: none; border-radius: 6px; font-size: 15px; font-weight: bold; }
    .footer { padding: 20px 40px; font-size: 12px; color: #888; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>¡Tu cuenta de Ankode está activa nuevamente!</h1>
    </div>
    <div class="body">
      <p>Hola <strong>${ownerName || to}</strong>,</p>
      <p>Tu suscripción de Ankode para el negocio <strong>${businessName || "tu cuenta"}</strong> ha sido reactivada exitosamente.</p>
      <div class="detail">
        <p><strong>Estado:</strong> Activa</p>
        ${nextPaymentText ? `<p><strong>Próximo pago:</strong> ${nextPaymentText}</p>` : ""}
      </div>
      <p>Ya puedes iniciar sesión y continuar usando Ankode POS normalmente.</p>
      <a class="btn" href="${loginUrl}">Acceder a Ankode</a>
      <p style="margin-top:24px; font-size:13px; color:#555;">
        Si el botón no funciona, copia este enlace:<br />
        <a href="${loginUrl}">${loginUrl}</a>
      </p>
    </div>
    <div class="footer">
      ¿Dudas? Escríbenos a soporte@ankode.mx
    </div>
  </div>
</body>
</html>`.trim();

  const text = [
    `¡Tu cuenta de Ankode ha sido reactivada!`,
    ``,
    `Hola ${ownerName || to},`,
    `Tu suscripción para el negocio "${businessName}" ha sido reactivada.`,
    nextPaymentText ? `Próximo pago: ${nextPaymentText}` : "",
    ``,
    `Accede en: ${loginUrl}`,
    `¿Dudas? soporte@ankode.mx`
  ].filter(Boolean).join("\n");

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject: "¡Tu cuenta de Ankode ha sido reactivada!",
      html,
      text
    });
    console.info(`[EMAIL] Reactivation email sent to ${to}`);
  } catch (error) {
    console.error(`[EMAIL] Failed to send reactivation email to ${to}:`, error.message);
  }
}

module.exports = {
  sendWelcomeEmail,
  sendTrialWelcomeEmail,
  sendPaymentFailedEmail,
  sendPaymentConfirmationEmail,
  sendSpeiInstructionsEmail,
  sendPasswordResetEmail,
  sendCancellationEmail,
  sendReactivationEmail
};
