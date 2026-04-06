const express = require("express");
const controller = require("../controllers/profileController");
const { requireRole } = require("../middleware/authMiddleware");
const { uploadProfileAsset } = require("../middleware/profileAssetUpload");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin", "cajero", "cashier", "user"]), controller.getProfile);
router.put("/general", requireRole(["superusuario", "superadmin", "admin"]), controller.generalValidation, controller.updateGeneral);
router.put("/banking", requireRole(["superusuario", "superadmin", "admin"]), controller.bankingValidation, controller.updateBanking);
router.put("/fiscal", requireRole(["superusuario", "superadmin", "admin"]), controller.fiscalValidation, controller.updateFiscal);
router.put("/stamps", requireRole(["superusuario", "superadmin"]), controller.stampsValidation, controller.updateStamps);
router.post("/assets/:assetType", requireRole(["superusuario", "superadmin", "admin"]), controller.assetTypeValidation, uploadProfileAsset, controller.uploadAsset);
router.delete("/assets/:assetType", requireRole(["superusuario", "superadmin", "admin"]), controller.assetTypeValidation, controller.removeAsset);

module.exports = router;
