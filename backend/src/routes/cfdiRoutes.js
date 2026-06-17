const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/cfdiController");
const { requireRole } = require("../middleware/authMiddleware");
const { uploadCsd } = require("../middleware/csdUpload");

// requireAuth se aplica de forma centralizada en app.js (auth: true).
// Las rutas /admin/* además exigen rol superusuario.

router.get("/status", ctrl.getAddonStatus);
router.post("/admin/activate", requireRole(["superusuario"]), ctrl.activateAddon);
router.post("/admin/deactivate", requireRole(["superusuario"]), ctrl.deactivateAddon);
router.put("/config", ctrl.updateCfdiConfig);
router.get("/invoices", ctrl.listInvoices);
router.post("/invoices", ctrl.stampInvoice);
router.post("/organization", requireRole(["admin", "superusuario"]), ctrl.createOrganization);
router.post("/csd", requireRole(["admin", "superusuario"]), uploadCsd, ctrl.uploadCsd);
router.post("/activate-live", requireRole(["admin", "superusuario"]), ctrl.activateLiveMode);

module.exports = router;
