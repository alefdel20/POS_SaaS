const asyncHandler = require("../utils/asyncHandler");
const { requireActorBusinessId } = require("../utils/tenant");
const clientService = require("../services/clientService");
const pool = require("../db/pool");

const listClients = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const clients = await clientService.listClients(businessId, {
    search: req.query.search,
    includeDeleted: req.query.include_deleted === "true"
  });
  res.json(clients);
});

const findOrCreateClient = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const { name, phone, email } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "name is required" });
  }
  const client = await clientService.findOrCreateClient(businessId, { name, phone, email });
  res.json(client);
});

const updateClient = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const clientId = Number(req.params.clientId);
  const updated = await clientService.updateClient(businessId, clientId, req.body);
  res.json(updated);
});

const softDeleteClient = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const clientId = Number(req.params.clientId);
  await clientService.softDeleteClient(businessId, clientId);
  res.json({ deleted: true });
});

const backfillClients = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const result = await clientService.backfillClientsFromSales(businessId);
  res.json(result);
});

const getClientBalance = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const clientId = Number(req.params.id);
  const { rows } = await pool.query(
    `SELECT
       c.credit_limit,
       c.credit_days,
       COALESCE(SUM(s.balance_due), 0)                    AS deuda_total,
       COUNT(CASE WHEN s.balance_due > 0 THEN 1 END)::int AS ventas_pendientes
     FROM clients c
     LEFT JOIN sales s
       ON s.client_id     = c.id
      AND s.business_id   = c.business_id
      AND s.status        = 'completed'
      AND s.payment_method = 'credit'
     WHERE c.id          = $1
       AND c.business_id = $2
     GROUP BY c.id`,
    [clientId, businessId]
  );
  if (!rows[0]) return res.status(404).json({ message: "Client not found" });
  const row = rows[0];
  res.json({
    credit_limit:      row.credit_limit      !== null ? Number(row.credit_limit) : null,
    credit_days:       Number(row.credit_days || 30),
    deuda_total:       Number(row.deuda_total || 0),
    ventas_pendientes: Number(row.ventas_pendientes || 0)
  });
});

module.exports = { listClients, findOrCreateClient, updateClient, softDeleteClient, backfillClients, getClientBalance };
