const { normalizeRole } = require("./roles");

function isSuperUser(actor) {
  return normalizeRole(actor?.role) === "superusuario";
}

function getActorBusinessId(actor) {
  return actor?.business_id ? Number(actor.business_id) : null;
}

function requireActorBusinessId(actor) {
  const businessId = getActorBusinessId(actor);
  if (!businessId) {
    throw new Error("Authenticated user is missing business context");
  }

  return businessId;
}

function canBypassBusinessScope(actor) {
  return isSuperUser(actor);
}

function scopedWhere(alias, actor, startIndex = 1, column = "business_id") {
  if (canBypassBusinessScope(actor)) {
    return {
      clause: "",
      params: [],
      nextIndex: startIndex
    };
  }

  return {
    clause: `WHERE ${alias}.${column} = $${startIndex}`,
    params: [requireActorBusinessId(actor)],
    nextIndex: startIndex + 1
  };
}

function scopedAnd(alias, actor, startIndex = 1, column = "business_id") {
  if (canBypassBusinessScope(actor)) {
    return {
      clause: "",
      params: [],
      nextIndex: startIndex
    };
  }

  return {
    clause: `AND ${alias}.${column} = $${startIndex}`,
    params: [requireActorBusinessId(actor)],
    nextIndex: startIndex + 1
  };
}

module.exports = {
  isSuperUser,
  getActorBusinessId,
  requireActorBusinessId,
  canBypassBusinessScope,
  scopedWhere,
  scopedAnd
};
