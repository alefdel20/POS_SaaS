const asyncHandler = require("../utils/asyncHandler");
const { requireActorBusinessId } = require("../utils/tenant");
const clientService = require("../services/clientService");

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

module.exports = { listClients, findOrCreateClient, updateClient, softDeleteClient };
