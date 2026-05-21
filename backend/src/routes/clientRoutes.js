const express = require("express");
const controller = require("../controllers/clientController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

const MANAGERS = ["superadmin", "admin", "gerente"];
const WITH_CASHIERS = [...MANAGERS, "cajero", "cashier"];

router.get("/", requireRole(MANAGERS), controller.listClients);
router.post("/backfill", requireRole(["superadmin", "admin"]), controller.backfillClients);
router.post("/", requireRole(WITH_CASHIERS), controller.findOrCreateClient);
router.get("/:id/balance", requireRole(WITH_CASHIERS), controller.getClientBalance);
router.put("/:clientId", requireRole(MANAGERS), controller.updateClient);
router.delete("/:clientId", requireRole(MANAGERS), controller.softDeleteClient);

module.exports = router;
