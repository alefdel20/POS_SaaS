const ApiError = require("./ApiError");
const { normalizeRole } = require("./roles");

function isSuperUser(actor) {
  return normalizeRole(actor?.role) === "superusuario";
}

function getActorBusinessId(actor) {
  const businessId = Number(actor?.business_id);
  if (!Number.isInteger(businessId) || businessId <= 0) {
    return null;
  }

  return businessId;
}

function requireActorBusinessId(actor) {
  const businessId = getActorBusinessId(actor);
  if (!businessId) {
    throw new ApiError(401, "Authenticated user is missing business context");
  }

  return businessId;
}

function scopedWhere(alias, actor, startIndex = 1, column = "business_id") {
  return {
    clause: `WHERE ${alias}.${column} = $${startIndex}`,
    params: [requireActorBusinessId(actor)],
    nextIndex: startIndex + 1
  };
}

function scopedAnd(alias, actor, startIndex = 1, column = "business_id") {
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
  scopedWhere,
  scopedAnd
};
