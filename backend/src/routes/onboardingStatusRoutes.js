const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

router.get("/status", async (req, res) => {
  const { order_id } = req.query;
  if (!order_id) return res.status(400).json({ error: "order_id requerido" });

  const { rows } = await pool.query(
    "SELECT status, email FROM pending_onboardings WHERE order_id = $1 LIMIT 1",
    [String(order_id)]
  );

  if (!rows[0]) return res.status(404).json({ error: "Orden no encontrada" });

  return res.json({
    status: rows[0].status,
    email: rows[0].status === "provisioned" ? rows[0].email : null,
  });
});

module.exports = router;
