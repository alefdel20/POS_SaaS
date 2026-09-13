const express = require("express");
const controller = require("../controllers/printController");

const router = express.Router();

// Public on purpose: QZ Tray's client calls qz.security.setCertificatePromise()
// to fetch this before printing, independent of the app's own login state —
// see backend/src/app.js's `routes` table, where this router is mounted with
// auth:false (mirrors the onboarding-status/onboarding split at app.js:116-117:
// requireAuth is applied per whole mounted router there, not per individual
// route, so a public GET and an authenticated POST under /print cannot live
// in the same router file without requireRole silently rejecting everyone —
// req.user would never be populated on this path if requireAuth were skipped
// for it, so the truly authenticated /print/sign route lives in
// printRoutes.js instead, mounted with auth:true).
router.get("/certificate", controller.getCertificate);

module.exports = router;
