const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const {
  POS_TYPE_OPTIONS,
  normalizePosType,
  canUseCreditCollections,
  canUseExpiryDate,
  canUseIeps
} = require("../utils/business");

const DEFAULT_UNITS = ["pieza", "kg", "litro", "caja"];
const HEALTHCARE_MODULES_BY_POS_TYPE = {
  Veterinaria: [
    "catalog",
    "inventory_batches",
    "veterinary_records",
    "veterinary_consultations",
    "prescriptions",
    "dispensing",
    "temperature_humidity"
  ],
  Dentista: [
    "catalog",
    "clinical_records",
    "clinical_consultations",
    "prescriptions"
  ],
  Farmacia: [
    "catalog",
    "inventory_batches",
    "dispensing",
    "temperature_humidity"
  ],
  FarmaciaConsultorio: [
    "catalog",
    "inventory_batches",
    "clinical_records",
    "clinical_consultations",
    "prescriptions",
    "dispensing",
    "antibiotic_control",
    "temperature_humidity"
  ],
  ClinicaChica: [
    "catalog",
    "clinical_records",
    "clinical_consultations",
    "prescriptions"
  ],
  Otro: ["catalog"]
};

function getHealthcareModules(posType) {
  return HEALTHCARE_MODULES_BY_POS_TYPE[posType] || HEALTHCARE_MODULES_BY_POS_TYPE.Otro;
}

const DEFAULT_TEMPLATES = {
  Tienda: {
    categories: ["Abarrotes", "Bebidas", "Botanas", "Limpieza", "Higiene personal"],
    settings: { default_sale_unit: "pieza", enabled_modules: ["sales", "products", "suppliers"] }
  },
  Tlapaleria: {
    categories: ["Herramientas", "Tornilleria", "Pintura", "Electricidad", "Plomeria"],
    settings: { default_sale_unit: "pieza", enabled_modules: ["sales", "products", "suppliers"] }
  },
  Papeleria: {
    categories: ["Cuadernos", "Escritura", "Oficina", "Arte", "Escolar"],
    settings: { default_sale_unit: "pieza", enabled_modules: ["sales", "products", "suppliers"] }
  },
  Veterinaria: {
    categories: [
      "Medicamentos",
      "Insumos medicamentos",
      "Insumos alimentos",
      "Insumos médicos/fármacos",
      "Accesorios e insumos"
    ],
    settings: {
      default_sale_unit: "pieza",
      sidebar_variant: "veterinary",
      enabled_modules: [
        "sales",
        "products",
        "services",
        "suppliers",
        "clients",
        "patients",
        "medical_appointments",
        "medical_consultations",
        "medical_history"
      ],
      healthcare_modules: getHealthcareModules("Veterinaria"),
      compliance_profile: "veterinary"
    }
  },
  Dentista: {
    categories: ["Material dental", "Instrumental", "Limpieza", "Consulta", "Consumibles"],
    settings: {
      default_sale_unit: "pieza",
      enabled_modules: ["sales", "products", "services", "clients", "patients", "medical_appointments", "medical_consultations", "medical_history"],
      healthcare_modules: getHealthcareModules("Dentista"),
      compliance_profile: "clinical_basic"
    }
  },
  Farmacia: {
    categories: ["Medicamentos", "Vitaminas", "Cuidado personal", "Curacion", "Bebes"],
    settings: {
      default_sale_unit: "pieza",
      enabled_modules: ["sales", "products", "suppliers", "inventory_batches", "dispensing"],
      healthcare_modules: getHealthcareModules("Farmacia"),
      compliance_profile: "pharmacy_basic"
    }
  },
  FarmaciaConsultorio: {
    categories: ["Medicamentos", "Consulta", "Curacion", "Equipo medico", "Cuidado personal"],
    settings: {
      default_sale_unit: "pieza",
      enabled_modules: ["sales", "products", "services", "suppliers", "clients", "patients", "medical_appointments", "medical_consultations", "medical_history", "inventory_batches", "dispensing"],
      healthcare_modules: getHealthcareModules("FarmaciaConsultorio"),
      compliance_profile: "pharmacy_consultorio"
    }
  },
  ClinicaChica: {
    categories: ["Consulta", "Curacion", "Medicamento", "Laboratorio", "Equipo medico"],
    settings: {
      default_sale_unit: "pieza",
      enabled_modules: ["sales", "products", "services", "clients", "patients", "medical_appointments", "medical_consultations", "medical_history"],
      healthcare_modules: getHealthcareModules("ClinicaChica"),
      compliance_profile: "clinical_basic"
    }
  },
  Otro: {
    categories: ["General"],
    settings: { default_sale_unit: "pieza", enabled_modules: ["sales", "products", "suppliers"] }
  }
};

async function ensureDefaultTemplates(client) {
  for (const posType of POS_TYPE_OPTIONS) {
    const template = DEFAULT_TEMPLATES[posType] || DEFAULT_TEMPLATES.Otro;
    await client.query(
      `INSERT INTO pos_templates (pos_type, type, data)
       VALUES ($1, 'categories', $2::jsonb)
       ON CONFLICT (pos_type, type)
       DO UPDATE SET data = EXCLUDED.data`,
      [posType, JSON.stringify(template.categories)]
    );
    await client.query(
      `INSERT INTO pos_templates (pos_type, type, data)
       VALUES ($1, 'settings', $2::jsonb)
       ON CONFLICT (pos_type, type)
       DO UPDATE SET data = EXCLUDED.data`,
      [posType, JSON.stringify({
        ...template.settings,
        allowed_units: DEFAULT_UNITS,
        supports_ieps: canUseIeps(posType),
        supports_expiry_date: canUseExpiryDate(posType),
        supports_credit_collections: canUseCreditCollections(posType)
      })]
    );
  }
}

async function loadTemplate(client, posType, type) {
  const { rows } = await client.query(
    `SELECT data
     FROM pos_templates
     WHERE pos_type = $1 AND type = $2
     LIMIT 1`,
    [posType, type]
  );
  return rows[0]?.data || null;
}

function buildOnboardingSettings(currentSettings, posType, categories, actor) {
  const healthcareModules = getHealthcareModules(posType);

  return {
    ...(currentSettings || {}),
    onboarding: {
      completed: true,
      completed_at: new Date().toISOString(),
      completed_by: actor.id,
      pos_type: posType,
      inserted_categories: categories,
      default_units: DEFAULT_UNITS
    },
    product_rules: {
      ...(currentSettings?.product_rules || {}),
      show_ieps: canUseIeps(posType),
      show_expiry_date: canUseExpiryDate(posType),
      managed_discount_from_products: false
    },
    business_features: {
      ...(currentSettings?.business_features || {}),
      daily_cut: true,
      credit_collections: canUseCreditCollections(posType),
      billing_enabled: true,
      healthcare_modules: healthcareModules,
      regulated_dispensing: ["Farmacia", "FarmaciaConsultorio"].includes(posType),
      clinical_records_enabled: ["Veterinaria", "Dentista", "FarmaciaConsultorio", "ClinicaChica"].includes(posType)
    },
    navigation: {
      ...(currentSettings?.navigation || {}),
      sidebar_variant: posType === "Veterinaria" ? "veterinary" : "default"
    },
    compliance: {
      ...(currentSettings?.compliance || {}),
      profile:
        posType === "Veterinaria"
          ? "veterinary"
          : ["Farmacia", "FarmaciaConsultorio"].includes(posType)
            ? "pharmacy"
            : ["Dentista", "ClinicaChica"].includes(posType)
              ? "clinical"
              : "general",
      access_audit_required: ["Veterinaria", "Dentista", "FarmaciaConsultorio", "ClinicaChica"].includes(posType),
      append_only_corrections: true,
      retain_regulatory_records: true
    }
  };
}

async function setupOnboarding(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const posType = normalizePosType(payload.pos_type || actor.pos_type);
  const businessName = String(payload.business_name || "").trim();

  if (!businessName) {
    throw new ApiError(400, "Business name is required");
  }
  if (!posType) {
    throw new ApiError(400, "Invalid business POS type");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureDefaultTemplates(client);

    const { rows: businessRows } = await client.query(
      `UPDATE businesses
       SET name = $1, business_type = $2, pos_type = $2, updated_by = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [businessName, posType, actor.id, businessId]
    );
    const business = businessRows[0];
    if (!business) {
      throw new ApiError(404, "Business not found");
    }

    await client.query(
      `UPDATE users
       SET pos_type = $1
       WHERE business_id = $2
         AND role IN ('admin', 'superusuario', 'soporte')`,
      [posType, businessId]
    );

    const { rows: profileRows } = await client.query(
      `INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active, created_by, updated_by, company_name)
       VALUES ($1, 'default', '{}'::jsonb, TRUE, $2, $2, $3)
       ON CONFLICT (business_id, profile_key)
       DO UPDATE SET company_name = EXCLUDED.company_name, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [businessId, actor.id, businessName]
    );
    const profile = profileRows[0];

    const categoryTemplate = loadTemplate(client, posType, "categories");
    const settingsTemplate = loadTemplate(client, posType, "settings");
    const [categoriesData, settingsData] = await Promise.all([categoryTemplate, settingsTemplate]);
    const categories = Array.isArray(categoriesData) ? categoriesData.map((value) => String(value).trim()).filter(Boolean) : [];

    for (const category of categories) {
      await client.query(
        `INSERT INTO product_categories (business_id, name, source, created_by)
         VALUES ($1, $2, 'onboarding', $3)
         ON CONFLICT (business_id, LOWER(name))
         DO NOTHING`,
        [businessId, category, actor.id]
      );
    }

    const nextSettings = buildOnboardingSettings(profile.general_settings, posType, categories, actor);
    nextSettings.default_sale_units = DEFAULT_UNITS;
    nextSettings.suggested_settings = settingsData || {};

    const { rows: updatedProfileRows } = await client.query(
      `UPDATE company_profiles
       SET company_name = $1,
           general_settings = $2::jsonb,
           updated_by = $3,
           updated_at = NOW()
       WHERE id = $4 AND business_id = $5
       RETURNING *`,
      [businessName, JSON.stringify(nextSettings), actor.id, profile.id, businessId]
    );

    await client.query("COMMIT");
    return {
      business,
      profile: updatedProfileRows[0],
      onboarding_completed: true,
      inserted_categories: categories,
      default_units: DEFAULT_UNITS,
      settings: settingsData || {}
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  setupOnboarding
};
