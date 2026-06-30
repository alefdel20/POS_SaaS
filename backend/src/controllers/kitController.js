const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const kitService = require("../services/kitService");
const { requireActorBusinessId } = require("../utils/tenant");

const listValidation = [
  query("activeOnly").optional().isBoolean(),
  query("search").optional().trim(),
  validateRequest
];

const idValidation = [
  param("id").isInt({ min: 1 }),
  validateRequest
];

const itemsValidation = [
  body("items").isArray({ min: 1 }).withMessage("El kit debe tener al menos un componente"),
  body("items.*.product_id").isInt({ min: 1 }).withMessage("product_id de componente inválido"),
  body("items.*.quantity").isFloat({ gt: 0 }).withMessage("La cantidad del componente debe ser mayor a cero"),
  validateRequest
];

const createValidation = [
  body("name").trim().notEmpty().withMessage("El nombre es requerido"),
  body("sku").optional({ values: "falsy" }).trim(),
  body("description").optional().trim(),
  body("price_mode").isIn(["fixed", "calculated"]).withMessage("price_mode debe ser 'fixed' o 'calculated'"),
  body("fixed_price").optional({ values: "falsy" }).isFloat({ min: 0 }).withMessage("fixed_price debe ser un número positivo"),
  body("discount_pct").optional().isFloat({ min: 0, max: 100 }).withMessage("discount_pct debe estar entre 0 y 100"),
  ...itemsValidation
];

const updateValidation = [
  body("name").optional().trim().notEmpty().withMessage("El nombre no puede estar vacío"),
  body("sku").optional({ values: "falsy" }).trim(),
  body("description").optional().trim(),
  body("price_mode").optional().isIn(["fixed", "calculated"]).withMessage("price_mode debe ser 'fixed' o 'calculated'"),
  body("fixed_price").optional({ values: "falsy" }).isFloat({ min: 0 }).withMessage("fixed_price debe ser un número positivo"),
  body("discount_pct").optional().isFloat({ min: 0, max: 100 }).withMessage("discount_pct debe estar entre 0 y 100"),
  body("items").optional().isArray({ min: 1 }).withMessage("items debe ser un array con al menos un elemento"),
  body("items.*.product_id").optional().isInt({ min: 1 }),
  body("items.*.quantity").optional().isFloat({ gt: 0 }),
  validateRequest
];

const listKits = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const kits = await kitService.listKits(businessId, {
    activeOnly: req.query.activeOnly === "true",
    search: req.query.search
  });
  res.json(kits);
});

const getKit = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const kit = await kitService.getKitById(businessId, Number(req.params.id));
  res.json(kit);
});

const createKit = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const kit = await kitService.createKit(businessId, req.body);
  res.status(201).json(kit);
});

const updateKit = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const kit = await kitService.updateKit(businessId, Number(req.params.id), req.body);
  res.json(kit);
});

const deleteKit = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const result = await kitService.deleteKit(businessId, Number(req.params.id));
  res.json(result);
});

module.exports = {
  listValidation,
  idValidation,
  createValidation,
  updateValidation,
  listKits,
  getKit,
  createKit,
  updateKit,
  deleteKit
};
