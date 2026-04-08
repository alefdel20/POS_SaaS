const express = require("express");
const controller = require("../controllers/productUpdateRequestController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin", "cajero"]), controller.listValidation, controller.listProductUpdateRequests);
router.get("/pending-summary", requireRole(["superusuario", "superadmin", "admin"]), controller.getPendingSummary);
router.get("/summary", requireRole(["superusuario", "superadmin", "admin", "cajero"]), controller.getRequestSummary);
router.post("/", requireRole(["cajero"]), controller.createValidation, controller.createProductUpdateRequest);
router.post("/:id/review", requireRole(["superusuario", "superadmin", "admin"]), controller.reviewValidation, controller.reviewProductUpdateRequest);

module.exports = router;
