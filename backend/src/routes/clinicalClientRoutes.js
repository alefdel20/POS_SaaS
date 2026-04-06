const express = require("express");
const controller = require("../controllers/clinicalClientController");
const { requireClinicalAccess } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireClinicalAccess, controller.listValidation, controller.listClients);
router.post("/", requireClinicalAccess, controller.createValidation, controller.createClient);
router.get("/:id", requireClinicalAccess, controller.idValidation, controller.getClientDetail);
router.put("/:id", requireClinicalAccess, controller.updateValidation, controller.updateClient);
router.patch("/:id/status", requireClinicalAccess, controller.statusValidation, controller.updateClientStatus);

module.exports = router;
