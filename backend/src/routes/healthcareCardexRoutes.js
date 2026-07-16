const express = require("express");
const controller = require("../controllers/healthcareCardexController");
const { requireClinicalAccess } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireClinicalAccess, controller.listValidation, controller.listCardexEntries);
router.post("/", requireClinicalAccess, controller.createValidation, controller.createCardexEntry);

module.exports = router;
