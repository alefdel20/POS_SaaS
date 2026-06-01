const { createHash, randomBytes } = require("crypto");
const bcrypt = require("bcryptjs");
const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const authService = require("../services/authService");
const userService = require("../services/userService");
const { BUSINESS_TYPE_OPTIONS, POS_TYPE_OPTIONS } = require("../utils/business");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { sendPasswordResetEmail } = require("../services/emailService");
const { frontendUrl } = require("../config/env");
const { resolvePlanKey, getPlanFeatures } = require("../config/planFeatures");

const loginValidation = [
  body("identifier").trim().notEmpty(),
  body("password").trim().notEmpty(),
  validateRequest
];
const changePasswordValidation = [
  body("current_password").trim().notEmpty(),
  body("new_password").isLength({ min: 8 }),
  validateRequest
];
const registerBusinessValidation = [
  body("full_name").trim().notEmpty(),
  body("business_name").trim().notEmpty(),
  body("username").trim().notEmpty(),
  body("email").isEmail(),
  body("password").isLength({ min: 8 }),
  body("role").isIn(["superusuario", "superadmin", "admin"]),
  body("business_type").isIn(BUSINESS_TYPE_OPTIONS),
  body("pos_type").isIn(POS_TYPE_OPTIONS),
  validateRequest
];

const login = asyncHandler(async (req, res) => {
  res.json(await authService.login(req.body.identifier, req.body.password));
});

const registerBusiness = asyncHandler(async (req, res) => {
  res.status(201).json(await authService.registerBusiness(req.body));
});

const me = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT plan_name, trial_ends_at FROM business_subscriptions
     WHERE business_id = $1
     LIMIT 1`,
    [req.user?.business_id]
  );
  const planName = rows[0]?.plan_name || null;
  const planKey = resolvePlanKey(planName);
  const planFeatures = getPlanFeatures(planName);

  let trialDaysRemaining = null;
  let isTrial = false;

  if (req.user?.business_id && !["superusuario", "soporte"].includes(req.user.role)) {
    const trialEndsAt = rows[0]?.trial_ends_at ?? null;
    if (trialEndsAt) {
      const diffMs = new Date(trialEndsAt) - new Date();
      trialDaysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      isTrial = trialDaysRemaining > 0;
    }
  }

  res.json({
    user: {
      ...req.user,
      has_ai_access: planFeatures.ai_chat,
      plan_key: planKey,
      plan_features: planFeatures,
      trial_days_remaining: trialDaysRemaining,
      is_trial: isTrial
    }
  });
});

const changePassword = asyncHandler(async (req, res) => {
  res.json(await userService.changeOwnPassword(req.user.id, { ...req.body, actor: req.user }));
});

const forgotPasswordValidation = [
  body("email").isEmail().normalizeEmail(),
  validateRequest
];

const resetPasswordValidation = [
  body("token").trim().notEmpty(),
  body("new_password").isLength({ min: 8 }).withMessage("La contraseña debe tener al menos 8 caracteres"),
  validateRequest
];

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const { rows } = await pool.query(
    "SELECT id FROM users WHERE email = $1 AND is_active = TRUE LIMIT 1",
    [email]
  );

  if (rows[0]) {
    const userId = rows[0].id;
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
    await pool.query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [userId, tokenHash, expiresAt]
    );

    const resetLink = `${frontendUrl}/reset-password?token=${token}`;
    await sendPasswordResetEmail(email, resetLink);
  }

  res.json({ message: "Si el correo existe, recibirás un enlace de recuperación." });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token, new_password } = req.body;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { rows } = await pool.query(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token_hash = $1 AND expires_at > NOW() AND used_at IS NULL
     LIMIT 1`,
    [tokenHash]
  );

  if (!rows[0]) {
    throw new ApiError(400, "Token inválido o expirado");
  }

  const { id: tokenId, user_id } = rows[0];
  const passwordHash = await bcrypt.hash(new_password, 10);

  await pool.query(
    `UPDATE users
     SET password_hash = $1, password_changed_at = NOW(), must_change_password = FALSE, updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, user_id]
  );

  await pool.query(
    "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1",
    [tokenId]
  );

  res.json({ message: "Contraseña actualizada correctamente." });
});

module.exports = {
  loginValidation,
  changePasswordValidation,
  registerBusinessValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  login,
  registerBusiness,
  me,
  changePassword,
  forgotPassword,
  resetPassword
};
