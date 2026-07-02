const express = require("express");
const controller = require("../controllers/medicalPreventiveEventController");
const { requireClinicalAccess } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireClinicalAccess, controller.listValidation, controller.listPreventiveEvents);
router.post("/", requireClinicalAccess, controller.createValidation, controller.createPreventiveEvent);
router.get("/:id", requireClinicalAccess, controller.idValidation, controller.getPreventiveEventDetail);
router.put("/:id", requireClinicalAccess, controller.updateValidation, controller.updatePreventiveEvent);
router.patch("/:id/status", requireClinicalAccess, controller.statusValidation, controller.updatePreventiveEventStatus);

module.exports = router;
