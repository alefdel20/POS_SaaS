const express = require("express");
const controller = require("../controllers/productUpdateRequestController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), controller.listValidation, controller.listProductUpdateRequests);
router.get("/pending-summary", requireRole(["superusuario", "superadmin", "admin", "gerente"]), controller.getPendingSummary);
router.get("/summary", requireRole(["superusuario", "superadmin", "admin", "cajero"]), controller.getRequestSummary);
router.post("/", requireRole(["cajero"]), controller.createValidation, controller.createProductUpdateRequest);
router.post("/batch", requireRole(["cajero"]), controller.createBatchValidation, controller.createBatchProductUpdateRequests);
router.post("/:id/review", requireRole(["superusuario", "superadmin", "admin", "gerente"]), controller.reviewValidation, controller.reviewProductUpdateRequest);

module.exports = router;
