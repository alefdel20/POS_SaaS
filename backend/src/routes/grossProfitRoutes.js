const express = require("express");
const controller = require("../controllers/grossProfitController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

const allowed = requireRole(["superadmin", "admin", "gerente"]);

router.get("/",             allowed, controller.getReport);
router.get("/export/excel", allowed, controller.exportExcel);
router.get("/export/pdf",   allowed, controller.exportPdf);

module.exports = router;
