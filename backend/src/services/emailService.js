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
  const { businessName = "", ownerName = "", email = "", tempPassword = "", planName = "", amount = "" } = data;
  const EMAIL_FROM = getEmailFrom();
  const loginUrl = `${getFrontendUrl()}/login`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>¡Tu cuenta de Ankode está lista!</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; }
    .header { background: #0d9488; padding: 32px 40px; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; }
    .body { padding: 32px 40px; color: #333; font-size: 15px; line-height: 1.6; }
    .credentials { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
    .credentials p { margin: 6px 0; }
    .credentials strong { color: #0d9488; }
    .btn { display: inline-block; margin: 24px 0 0; padding: 12px 28px; background: #0d9488; color: #fff !important; text-decoration: none; border-radius: 6px; font-size: 15px; font-weight: bold; }
    .footer { padding: 20px 40px; font-size: 12px; color: #888; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>¡Tu cuenta de Ankode está lista!</h1>
    </div>
    <div class="body">
      <p>Hola <strong>${ownerName || email}</strong>,</p>
      <p>Tu pago fue procesado correctamente y tu negocio <strong>${businessName}</strong> ya está activo en Ankode POS.</p>
      <p>Usa las siguientes credenciales para acceder:</p>
      <div class="credentials">
        <p><strong>Negocio:</strong> ${businessName}</p>
        <p><strong>Usuario:</strong> ${email}</p>
        <p><strong>Contraseña temporal:</strong> ${tempPassword}</p>
      </div>
      <p>Te recomendamos cambiar tu contraseña después de tu primer inicio de sesión.</p>
      <a class="btn" href="${loginUrl}">Acceder a Ankode</a>
      <p style="margin-top:24px; font-size:13px; color:#555;">
        Si el botón no funciona, copia este enlace en tu navegador:<br />
        <a href="${loginUrl}">${loginUrl}</a>
      </p>
    </div>
    <div class="footer">
      Este correo fue generado automáticamente. Si tienes dudas, contacta a soporte@ankode.mx
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = [
    `¡Tu cuenta de Ankode está lista!`,
    ``,
    `Hola ${ownerName || email},`,
    `Tu pago fue procesado y tu negocio "${businessName}" ya está activo.`,
    ``,
    `Credenciales de acceso:`,
    `  Usuario: ${email}`,
    `  Contraseña temporal: ${tempPassword}`,
    ``,
    `Accede en: ${loginUrl}`,
    ``,
    `Te recomendamos cambiar tu contraseña tras el primer inicio de sesión.`
  ].join("\n");

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject: "¡Tu cuenta de Ankode está lista!",
      html,
      text
    });
    console.info(`[EMAIL] Welcome email sent to ${to} for business "${businessName}"`);
  } catch (error) {
    console.error("[EMAIL] Error completo:", error);
  }

  // Admin purchase notification
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
// sendPasswordResetEmail
// Called after a self-service forgot-password request.
// Never throws — email failure is logged but does not expose user existence.
// ---------------------------------------------------------------------------

async function sendPasswordResetEmail(to, resetLink) {
  const EMAIL_FROM = getEmailFrom();

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Recupera tu contraseña — Ankode</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; }
    .header { background: #0d9488; padding: 32px 40px; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; }
    .body { padding: 32px 40px; color: #333; font-size: 15px; line-height: 1.6; }
    .btn { display: inline-block; margin: 24px 0 0; padding: 12px 28px; background: #0d9488; color: #fff !important; text-decoration: none; border-radius: 6px; font-size: 15px; font-weight: bold; }
    .note { margin-top: 20px; font-size: 13px; color: #666; }
    .footer { padding: 20px 40px; font-size: 12px; color: #888; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Recupera tu contraseña</h1>
    </div>
    <div class="body">
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en Ankode.</p>
      <p>Haz clic en el botón para crear una nueva contraseña. El enlace es válido por <strong>1 hora</strong>.</p>
      <a class="btn" href="${resetLink}">Restablecer contraseña</a>
      <p style="margin-top:24px; font-size:13px; color:#555;">
        Si el botón no funciona, copia este enlace en tu navegador:<br />
        <a href="${resetLink}">${resetLink}</a>
      </p>
      <p class="note">Si no solicitaste este cambio, ignora este correo. Tu contraseña no será modificada.</p>
    </div>
    <div class="footer">
      Este correo fue generado automáticamente. ¿Dudas? Escríbenos a soporte@ankode.mx
    </div>
  </div>
</body>
</html>`.trim();

  const text = [
    `Recupera tu contraseña — Ankode`,
    ``,
    `Recibimos una solicitud para restablecer la contraseña de tu cuenta.`,
    ``,
    `Haz clic en el siguiente enlace (válido por 1 hora):`,
    resetLink,
    ``,
    `Si no solicitaste este cambio, ignora este correo.`
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

module.exports = {
  sendWelcomeEmail,
  sendPaymentFailedEmail,
  sendPaymentConfirmationEmail,
  sendPasswordResetEmail
};
