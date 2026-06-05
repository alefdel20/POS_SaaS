// Map de clientes SSE por business_id
// clients: Map<number, Set<Express.Response>>

const clients = new Map();

function addClient(businessId, res) {
  if (!clients.has(businessId)) clients.set(businessId, new Set());
  clients.get(businessId).add(res);
}

function removeClient(businessId, res) {
  const set = clients.get(businessId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(businessId);
}

function emitToRoom(businessId, eventType, data) {
  const set = clients.get(Number(businessId));
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify({ type: eventType, ...data })}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch (_) { set.delete(res); }
  }
}

module.exports = { addClient, removeClient, emitToRoom };
