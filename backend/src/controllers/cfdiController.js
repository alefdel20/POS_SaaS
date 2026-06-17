const addonService = require("../services/addonService");
const cfdiService = require("../services/cfdiService");
const ApiError = require("../utils/ApiError");

// GET /cfdi/status — estado del addon para el negocio del usuario
async function getAddonStatus(req, res, next) {
  try {
    const businessId = req.user.business_id;
    const addon = await addonService.getAddonStatus(businessId, addonService.CFDI_ADDON_KEY);
    const config = addon?.status === 'active' ? await cfdiService.getCfdiConfig(businessId) : null;
    res.json({ addon: addon || { status: 'inactive' }, config });
  } catch (err) { next(err); }
}

// POST /cfdi/admin/activate — superusuario activa addon para un negocio
async function activateAddon(req, res, next) {
  try {
    if (req.user.role !== 'superusuario') throw new ApiError(403, "Acceso denegado");
    const { business_id, notes } = req.body;
    if (!business_id) throw new ApiError(400, "business_id requerido");
    const addon = await addonService.activateAddon(business_id, addonService.CFDI_ADDON_KEY, req.user.id, notes);
    res.json({ ok: true, addon });
  } catch (err) { next(err); }
}

// POST /cfdi/admin/deactivate — superusuario desactiva addon
async function deactivateAddon(req, res, next) {
  try {
    if (req.user.role !== 'superusuario') throw new ApiError(403, "Acceso denegado");
    const { business_id, notes } = req.body;
    if (!business_id) throw new ApiError(400, "business_id requerido");
    const addon = await addonService.deactivateAddon(business_id, addonService.CFDI_ADDON_KEY, req.user.id, notes);
    res.json({ ok: true, addon });
  } catch (err) { next(err); }
}

// PUT /cfdi/config — cliente guarda su config CFDI (solo si addon activo)
async function updateCfdiConfig(req, res, next) {
  try {
    const businessId = req.user.business_id;
    const addon = await addonService.getAddonStatus(businessId, addonService.CFDI_ADDON_KEY);
    if (addon?.status !== 'active') throw new ApiError(403, "Add-on CFDI no activo");
    const config = await cfdiService.upsertCfdiConfig(businessId, req.body);
    res.json(config);
  } catch (err) { next(err); }
}

// GET /cfdi/invoices — lista facturas del negocio
async function listInvoices(req, res, next) {
  try {
    const businessId = req.user.business_id;
    const addon = await addonService.getAddonStatus(businessId, addonService.CFDI_ADDON_KEY);
    if (addon?.status !== 'active') throw new ApiError(403, "Add-on CFDI no activo");
    const page = parseInt(req.query.page) || 1;
    const result = await cfdiService.listCfdiInvoices(businessId, { page });
    res.json(result);
  } catch (err) { next(err); }
}

// POST /cfdi/invoices — timbrar factura
async function stampInvoice(req, res, next) {
  try {
    const businessId = req.user.business_id;
    const addon = await addonService.getAddonStatus(businessId, addonService.CFDI_ADDON_KEY);
    if (addon?.status !== 'active') throw new ApiError(403, "Add-on CFDI no activo");

    const { sale_id, client_rfc, client_name, client_email, client_tax_regime, cfdi_use, items, total, payment_form } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, "Se requiere al menos un producto en items");
    }
    if (!total || isNaN(Number(total))) {
      throw new ApiError(400, "Se requiere el total de la factura");
    }

    const result = await cfdiService.stampInvoice(
      businessId,
      { sale_id, client_rfc, client_name, client_email, client_tax_regime, cfdi_use, items, total: Number(total), payment_form },
      req.user.id
    );

    res.status(201).json(result);
  } catch (err) { next(err); }
}

// POST /cfdi/organization — crea organización en Facturapi para el negocio
async function createOrganization(req, res, next) {
  try {
    const businessId = req.user.business_id;
    const addon = await addonService.getAddonStatus(businessId, addonService.CFDI_ADDON_KEY);
    if (addon?.status !== 'active') throw new ApiError(403, "Add-on CFDI no activo");

    const config = await cfdiService.createOrganization(businessId, req.body.legal_name);
    res.status(201).json({ ok: true, config });
  } catch (err) { next(err); }
}

// POST /cfdi/csd — sube CSD (.cer + .key + password) para la organización del negocio
async function uploadCsd(req, res, next) {
  try {
    const businessId = req.user.business_id;
    const addon = await addonService.getAddonStatus(businessId, addonService.CFDI_ADDON_KEY);
    if (addon?.status !== 'active') throw new ApiError(403, "Add-on CFDI no activo");

    const cerFile = req.files?.cer?.[0];
    const keyFile = req.files?.key?.[0];
    if (!cerFile || !keyFile) throw new ApiError(400, "Se requieren ambos archivos: .cer y .key");

    const { password } = req.body;
    if (!password) throw new ApiError(400, "La contraseña del CSD es requerida");

    const config = await cfdiService.uploadCsd(businessId, cerFile.buffer, keyFile.buffer, password);
    res.json({
      ok: true,
      csd_uploaded: config.csd_uploaded,
      csd_expires_at: config.csd_expires_at
    });
  } catch (err) { next(err); }
}

// POST /cfdi/activate-live — activa modo producción (genera live key, cambia pac_mode)
async function activateLiveMode(req, res, next) {
  try {
    const businessId = req.user.business_id;
    const addon = await addonService.getAddonStatus(businessId, addonService.CFDI_ADDON_KEY);
    if (addon?.status !== 'active') throw new ApiError(403, "Add-on CFDI no activo");

    await cfdiService.activateLiveMode(businessId);
    res.json({ ok: true, pac_mode: "production" });
  } catch (err) { next(err); }
}

module.exports = { getAddonStatus, activateAddon, deactivateAddon, updateCfdiConfig, listInvoices, stampInvoice, createOrganization, uploadCsd, activateLiveMode };
