// POST /products/restock/ticket/confirm, POST /products/restock/ticket/:id/void
// and GET /products/restock/ticket/recent.
// business_id comes only from req.user inside the service.
const asyncHandler = require("../utils/asyncHandler");
const { confirmPurchaseTicket, voidPurchaseTicket, listRecentPurchaseTickets } = require("../services/purchaseTicketConfirmService");

const confirmRestockTicket = asyncHandler(async (req, res) => {
  res.status(201).json(await confirmPurchaseTicket(req.user, req.body));
});

const voidRestockTicket = asyncHandler(async (req, res) => {
  res.json(await voidPurchaseTicket(req.user, req.params.id, req.body));
});

const listRecentRestockTickets = asyncHandler(async (req, res) => {
  res.json({ items: await listRecentPurchaseTickets(req.user) });
});

module.exports = { confirmRestockTicket, voidRestockTicket, listRecentRestockTickets };
