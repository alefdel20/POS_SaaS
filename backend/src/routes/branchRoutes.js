const express = require("express");
const router = express.Router();
const controller = require("../controllers/branchController");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");

router.get("/", requireAuth, controller.getBranches);
router.get("/:branchId", requireAuth, controller.getBranchById);
router.post("/", requireAuth, requireRole(["admin", "superusuario"]), controller.createBranch);
router.put("/:branchId", requireAuth, requireRole(["admin", "superusuario"]), controller.updateBranch);
router.delete("/:branchId", requireAuth, requireRole(["admin", "superusuario"]), controller.deactivateBranch);

module.exports = router;
