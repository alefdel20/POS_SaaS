const express = require("express");
const controller = require("../controllers/medicalPreventiveEventController");
const { requireClinicalAccess } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireClinicalAccess, controller.listValidation, controller.listPreventiveEvents);
router.post("/", requireClinicalAccess, controller.createValidation, controller.createPreventiveEvent);
router.put("/:id", requireClinicalAccess, controller.updateValidation, controller.updatePreventiveEvent);

module.exports = router;
