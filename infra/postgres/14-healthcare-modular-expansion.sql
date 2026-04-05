CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS healthcare;

CREATE OR REPLACE FUNCTION healthcare.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_id_business_id
  ON public.users (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_id_business_id
  ON public.products (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_id_business_id
  ON public.sales (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_id_business_id
  ON public.clients (id, business_id);

CREATE TABLE IF NOT EXISTS healthcare.business_modules (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  module_key VARCHAR(80) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  activated_at TIMESTAMPTZ,
  activated_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_modules_module_key_check CHECK (
    module_key IN (
      'clinical_core',
      'clinical_human',
      'clinical_dental',
      'veterinary_core',
      'pharmacy_core',
      'pharmacy_regulatory',
      'prescriptions',
      'dispensing',
      'inventory_batches',
      'temperature_humidity',
      'privacy_consents'
    )
  ),
  CONSTRAINT uq_business_modules UNIQUE (business_id, module_key)
);

CREATE TABLE IF NOT EXISTS healthcare.patients (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  patient_code VARCHAR(60),
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NOT NULL DEFAULT '',
  second_last_name VARCHAR(120) NOT NULL DEFAULT '',
  sex VARCHAR(20),
  birth_date DATE,
  blood_type VARCHAR(5),
  phone VARCHAR(40),
  email VARCHAR(120),
  address TEXT NOT NULL DEFAULT '',
  occupation VARCHAR(120),
  emergency_contact_name VARCHAR(180),
  emergency_contact_phone VARCHAR(40),
  allergies_summary TEXT NOT NULL DEFAULT '',
  chronic_conditions_summary TEXT NOT NULL DEFAULT '',
  privacy_level VARCHAR(20) NOT NULL DEFAULT 'standard',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT patients_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT uq_healthcare_patients_business_code UNIQUE (business_id, patient_code),
  CONSTRAINT patients_status_check CHECK (status IN ('active', 'inactive', 'deceased', 'blocked')),
  CONSTRAINT patients_privacy_level_check CHECK (privacy_level IN ('standard', 'restricted', 'highly_restricted')),
  CONSTRAINT patients_sex_check CHECK (sex IS NULL OR sex IN ('female', 'male', 'intersex', 'unspecified'))
);

CREATE TABLE IF NOT EXISTS healthcare.clinical_encounters (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  patient_id BIGINT NOT NULL,
  clinician_user_id INTEGER REFERENCES public.users(id),
  encounter_type VARCHAR(30) NOT NULL DEFAULT 'consultation',
  encounter_status VARCHAR(20) NOT NULL DEFAULT 'completed',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  reason_for_visit TEXT NOT NULL DEFAULT '',
  triage_summary TEXT NOT NULL DEFAULT '',
  subjective_summary TEXT NOT NULL DEFAULT '',
  objective_summary TEXT NOT NULL DEFAULT '',
  assessment_summary TEXT NOT NULL DEFAULT '',
  plan_summary TEXT NOT NULL DEFAULT '',
  follow_up_instructions TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clinical_encounters_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT clinical_encounters_type_check CHECK (encounter_type IN ('consultation', 'follow_up', 'urgent_care', 'procedure', 'dental')),
  CONSTRAINT clinical_encounters_status_check CHECK (encounter_status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT clinical_encounters_row_status_check CHECK (status IN ('active', 'amended', 'entered_in_error')),
  CONSTRAINT clinical_encounters_time_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE IF NOT EXISTS healthcare.vital_sign_records (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  encounter_id BIGINT NOT NULL,
  patient_id BIGINT NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  temperature_c NUMERIC(5,2),
  systolic_bp NUMERIC(6,2),
  diastolic_bp NUMERIC(6,2),
  heart_rate_bpm NUMERIC(6,2),
  respiratory_rate_bpm NUMERIC(6,2),
  oxygen_saturation NUMERIC(5,2),
  weight_kg NUMERIC(8,3),
  height_cm NUMERIC(8,2),
  glucose_mg_dl NUMERIC(8,2),
  bmi NUMERIC(8,2),
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vital_sign_records_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT vital_sign_records_status_check CHECK (status IN ('active', 'corrected'))
);

CREATE TABLE IF NOT EXISTS healthcare.clinical_notes (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  encounter_id BIGINT NOT NULL,
  patient_id BIGINT NOT NULL,
  note_type VARCHAR(30) NOT NULL DEFAULT 'progress',
  note_text TEXT NOT NULL,
  authored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  appended_to_note_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clinical_notes_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT clinical_notes_type_check CHECK (note_type IN ('initial', 'progress', 'evolution', 'procedure', 'discharge', 'correction')),
  CONSTRAINT clinical_notes_status_check CHECK (status IN ('active', 'corrected', 'entered_in_error'))
);

CREATE TABLE IF NOT EXISTS healthcare.diagnoses (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  encounter_id BIGINT NOT NULL,
  patient_id BIGINT NOT NULL,
  diagnosis_code VARCHAR(40),
  diagnosis_label VARCHAR(255) NOT NULL,
  diagnosis_type VARCHAR(20) NOT NULL DEFAULT 'primary',
  diagnosis_status VARCHAR(20) NOT NULL DEFAULT 'active',
  diagnosed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT diagnoses_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT diagnoses_type_check CHECK (diagnosis_type IN ('primary', 'secondary', 'presumptive', 'differential')),
  CONSTRAINT diagnoses_status_check CHECK (diagnosis_status IN ('active', 'resolved', 'ruled_out', 'corrected'))
);

CREATE TABLE IF NOT EXISTS healthcare.prescriptions (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  folio_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  subject_type VARCHAR(20) NOT NULL,
  patient_id BIGINT,
  pet_id BIGINT,
  clinical_encounter_id BIGINT,
  veterinary_encounter_id BIGINT,
  prescriber_user_id INTEGER REFERENCES public.users(id),
  document_folio_id BIGINT,
  prescription_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  indications_general TEXT NOT NULL DEFAULT '',
  diagnosis_summary TEXT NOT NULL DEFAULT '',
  issue_status VARCHAR(20) NOT NULL DEFAULT 'issued',
  regulatory_scope VARCHAR(20) NOT NULL DEFAULT 'standard',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prescriptions_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT prescriptions_folio_uuid_unique UNIQUE (folio_uuid),
  CONSTRAINT prescriptions_subject_check CHECK (subject_type IN ('human', 'pet')),
  CONSTRAINT prescriptions_issue_status_check CHECK (issue_status IN ('draft', 'issued', 'partially_dispensed', 'fully_dispensed', 'cancelled', 'expired')),
  CONSTRAINT prescriptions_regulatory_scope_check CHECK (regulatory_scope IN ('standard', 'antibiotic', 'controlled')),
  CONSTRAINT prescriptions_row_status_check CHECK (status IN ('active', 'corrected', 'entered_in_error')),
  CONSTRAINT prescriptions_subject_fk_check CHECK (
    (subject_type = 'human' AND patient_id IS NOT NULL AND pet_id IS NULL)
    OR
    (subject_type = 'pet' AND pet_id IS NOT NULL AND patient_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS healthcare.prescription_items (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  prescription_id BIGINT NOT NULL,
  product_id INTEGER NOT NULL,
  medication_catalog_id BIGINT,
  line_number INTEGER NOT NULL DEFAULT 1,
  item_type VARCHAR(20) NOT NULL DEFAULT 'medication',
  prescribed_quantity NUMERIC(14,3) NOT NULL,
  dispensed_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  dose VARCHAR(120),
  route VARCHAR(120),
  frequency VARCHAR(120),
  duration VARCHAR(120),
  instructions TEXT NOT NULL DEFAULT '',
  substitution_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  requires_batch_tracking BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prescription_items_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT prescription_items_type_check CHECK (item_type IN ('medication', 'supply', 'service')),
  CONSTRAINT prescription_items_status_check CHECK (status IN ('active', 'partially_dispensed', 'fully_dispensed', 'cancelled', 'corrected')),
  CONSTRAINT prescription_items_qty_check CHECK (prescribed_quantity > 0 AND dispensed_quantity >= 0 AND dispensed_quantity <= prescribed_quantity)
);

CREATE TABLE IF NOT EXISTS healthcare.pet_owners (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  client_id INTEGER,
  owner_code VARCHAR(60),
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NOT NULL DEFAULT '',
  phone VARCHAR(40),
  email VARCHAR(120),
  address TEXT NOT NULL DEFAULT '',
  tax_id VARCHAR(60),
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pet_owners_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT uq_pet_owners_business_code UNIQUE (business_id, owner_code),
  CONSTRAINT pet_owners_status_check CHECK (status IN ('active', 'inactive', 'blocked'))
);

CREATE TABLE IF NOT EXISTS healthcare.pets (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  owner_id BIGINT NOT NULL,
  pet_code VARCHAR(60),
  name VARCHAR(150) NOT NULL,
  species VARCHAR(120) NOT NULL,
  breed VARCHAR(120),
  sex VARCHAR(20),
  color_markings VARCHAR(120),
  birth_date DATE,
  weight_kg NUMERIC(8,3),
  sterilized BOOLEAN NOT NULL DEFAULT FALSE,
  microchip_number VARCHAR(80),
  allergies_summary TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pets_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT uq_pets_business_code UNIQUE (business_id, pet_code),
  CONSTRAINT pets_status_check CHECK (status IN ('active', 'inactive', 'deceased', 'blocked')),
  CONSTRAINT pets_sex_check CHECK (sex IS NULL OR sex IN ('female', 'male', 'intersex', 'unspecified'))
);

CREATE TABLE IF NOT EXISTS healthcare.veterinary_encounters (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  pet_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  veterinarian_user_id INTEGER REFERENCES public.users(id),
  encounter_type VARCHAR(30) NOT NULL DEFAULT 'consultation',
  encounter_status VARCHAR(20) NOT NULL DEFAULT 'completed',
  encounter_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  chief_complaint TEXT NOT NULL DEFAULT '',
  anamnesis TEXT NOT NULL DEFAULT '',
  physical_exam TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  weight_kg NUMERIC(8,3),
  temperature_c NUMERIC(5,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT veterinary_encounters_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT veterinary_encounters_type_check CHECK (encounter_type IN ('consultation', 'vaccination', 'surgery', 'grooming', 'follow_up', 'emergency')),
  CONSTRAINT veterinary_encounters_status_check CHECK (encounter_status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT veterinary_encounters_row_status_check CHECK (status IN ('active', 'amended', 'entered_in_error'))
);

CREATE TABLE IF NOT EXISTS healthcare.veterinary_notes (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  veterinary_encounter_id BIGINT NOT NULL,
  pet_id BIGINT NOT NULL,
  note_type VARCHAR(30) NOT NULL DEFAULT 'progress',
  note_text TEXT NOT NULL,
  authored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  appended_to_note_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT veterinary_notes_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT veterinary_notes_type_check CHECK (note_type IN ('initial', 'progress', 'evolution', 'procedure', 'correction')),
  CONSTRAINT veterinary_notes_status_check CHECK (status IN ('active', 'corrected', 'entered_in_error'))
);

CREATE TABLE IF NOT EXISTS healthcare.veterinary_treatments (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  veterinary_encounter_id BIGINT NOT NULL,
  pet_id BIGINT NOT NULL,
  product_id INTEGER,
  treatment_type VARCHAR(30) NOT NULL DEFAULT 'medication',
  treatment_name VARCHAR(255) NOT NULL,
  dose VARCHAR(120),
  route VARCHAR(120),
  frequency VARCHAR(120),
  duration VARCHAR(120),
  quantity NUMERIC(14,3),
  instructions TEXT NOT NULL DEFAULT '',
  administered_in_house BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT veterinary_treatments_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT veterinary_treatments_type_check CHECK (treatment_type IN ('medication', 'procedure', 'vaccination', 'diet', 'care')),
  CONSTRAINT veterinary_treatments_status_check CHECK (status IN ('active', 'stopped', 'completed', 'corrected'))
);

CREATE TABLE IF NOT EXISTS healthcare.medication_catalog (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  product_id INTEGER NOT NULL,
  active_ingredient VARCHAR(255) NOT NULL,
  strength VARCHAR(120),
  dosage_form VARCHAR(120),
  route_of_administration VARCHAR(120),
  requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
  is_antibiotic BOOLEAN NOT NULL DEFAULT FALSE,
  is_controlled_substance BOOLEAN NOT NULL DEFAULT FALSE,
  control_schedule VARCHAR(40),
  sanitary_registration VARCHAR(80),
  fraction_type VARCHAR(20) NOT NULL DEFAULT 'unit',
  target_species VARCHAR(120),
  storage_notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT medication_catalog_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT uq_medication_catalog_business_product UNIQUE (business_id, product_id),
  CONSTRAINT medication_catalog_fraction_type_check CHECK (fraction_type IN ('unit', 'blister', 'box', 'ml', 'g')),
  CONSTRAINT medication_catalog_status_check CHECK (status IN ('active', 'inactive', 'archived'))
);

CREATE TABLE IF NOT EXISTS healthcare.inventory_batches (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  product_id INTEGER NOT NULL,
  medication_catalog_id BIGINT,
  supplier_id INTEGER REFERENCES public.suppliers(id),
  batch_number VARCHAR(120) NOT NULL,
  serial_reference VARCHAR(120),
  manufactured_at DATE,
  expiry_date DATE NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quantity_received NUMERIC(14,3) NOT NULL,
  quantity_available NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,5),
  purchase_reference VARCHAR(120),
  storage_location VARCHAR(120),
  quarantine_status VARCHAR(20) NOT NULL DEFAULT 'released',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_batches_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT uq_inventory_batches_business_product_batch UNIQUE (business_id, product_id, batch_number),
  CONSTRAINT inventory_batches_qty_check CHECK (quantity_received > 0 AND quantity_available >= 0 AND quantity_available <= quantity_received),
  CONSTRAINT inventory_batches_quarantine_status_check CHECK (quarantine_status IN ('released', 'quarantine', 'blocked', 'expired')),
  CONSTRAINT inventory_batches_status_check CHECK (status IN ('active', 'depleted', 'expired', 'blocked'))
);

CREATE TABLE IF NOT EXISTS healthcare.dispensing_logs (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  folio_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  prescription_id BIGINT,
  prescription_item_id BIGINT,
  sale_id INTEGER,
  product_id INTEGER NOT NULL,
  batch_id BIGINT NOT NULL,
  subject_type VARCHAR(20) NOT NULL,
  patient_id BIGINT,
  pet_id BIGINT,
  dispensed_quantity NUMERIC(14,3) NOT NULL,
  unit_of_measure VARCHAR(30) NOT NULL DEFAULT 'pieza',
  dispensed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispensed_by_user_id INTEGER REFERENCES public.users(id),
  requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
  prescription_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'dispensed',
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dispensing_logs_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT dispensing_logs_folio_uuid_unique UNIQUE (folio_uuid),
  CONSTRAINT dispensing_logs_subject_check CHECK (subject_type IN ('human', 'pet', 'anonymous')),
  CONSTRAINT dispensing_logs_qty_check CHECK (dispensed_quantity > 0),
  CONSTRAINT dispensing_logs_status_check CHECK (status IN ('prepared', 'dispensed', 'reversed', 'corrected')),
  CONSTRAINT dispensing_logs_subject_fk_check CHECK (
    (subject_type = 'human' AND patient_id IS NOT NULL AND pet_id IS NULL)
    OR
    (subject_type = 'pet' AND pet_id IS NOT NULL AND patient_id IS NULL)
    OR
    (subject_type = 'anonymous' AND patient_id IS NULL AND pet_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS healthcare.antibiotic_dispensing_logs (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  dispensing_log_id BIGINT NOT NULL,
  prescription_id BIGINT,
  physician_name VARCHAR(255) NOT NULL,
  physician_license VARCHAR(80) NOT NULL,
  physician_institution VARCHAR(255),
  diagnosis_reference VARCHAR(255),
  retention_required BOOLEAN NOT NULL DEFAULT TRUE,
  retention_reference VARCHAR(120),
  book_entry_number VARCHAR(60),
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'recorded',
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT antibiotic_dispensing_logs_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT uq_antibiotic_dispensing_log UNIQUE (business_id, dispensing_log_id),
  CONSTRAINT antibiotic_dispensing_logs_status_check CHECK (status IN ('recorded', 'corrected'))
);

CREATE TABLE IF NOT EXISTS healthcare.controlled_substance_ledger (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  folio_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  product_id INTEGER NOT NULL,
  batch_id BIGINT,
  related_dispensing_log_id BIGINT,
  movement_type VARCHAR(20) NOT NULL,
  movement_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quantity NUMERIC(14,3) NOT NULL,
  quantity_balance NUMERIC(14,3) NOT NULL DEFAULT 0,
  reference_document VARCHAR(120),
  reason TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'posted',
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT controlled_substance_ledger_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT controlled_substance_ledger_folio_uuid_unique UNIQUE (folio_uuid),
  CONSTRAINT controlled_substance_ledger_type_check CHECK (movement_type IN ('purchase', 'dispense', 'adjustment_in', 'adjustment_out', 'return', 'destruction')),
  CONSTRAINT controlled_substance_ledger_status_check CHECK (status IN ('posted', 'corrected')),
  CONSTRAINT controlled_substance_ledger_qty_check CHECK (quantity > 0 AND quantity_balance >= 0)
);

CREATE TABLE IF NOT EXISTS healthcare.temperature_humidity_logs (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  area_code VARCHAR(80) NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  temperature_c NUMERIC(5,2) NOT NULL,
  humidity_percent NUMERIC(5,2),
  min_temperature_c NUMERIC(5,2),
  max_temperature_c NUMERIC(5,2),
  device_reference VARCHAR(120),
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'recorded',
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT temperature_humidity_logs_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT temperature_humidity_logs_status_check CHECK (status IN ('recorded', 'corrected')),
  CONSTRAINT temperature_humidity_logs_humidity_check CHECK (humidity_percent IS NULL OR (humidity_percent >= 0 AND humidity_percent <= 100))
);

CREATE TABLE IF NOT EXISTS healthcare.document_folios (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  document_type VARCHAR(40) NOT NULL,
  series VARCHAR(20) NOT NULL DEFAULT 'A',
  folio_number BIGINT NOT NULL,
  folio_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  related_table VARCHAR(80),
  related_record_uuid UUID,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'issued',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_folios_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT document_folios_folio_uuid_unique UNIQUE (folio_uuid),
  CONSTRAINT uq_document_folios_business_series_number UNIQUE (business_id, document_type, series, folio_number),
  CONSTRAINT document_folios_type_check CHECK (document_type IN ('prescription', 'dispensing', 'antibiotic_book', 'controlled_ledger', 'consent')),
  CONSTRAINT document_folios_status_check CHECK (status IN ('issued', 'voided', 'replaced'))
);

CREATE TABLE IF NOT EXISTS healthcare.record_corrections (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  target_table VARCHAR(80) NOT NULL,
  target_record_uuid UUID NOT NULL,
  correction_type VARCHAR(30) NOT NULL DEFAULT 'append_note',
  original_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  corrected_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  correction_note TEXT NOT NULL,
  reason TEXT NOT NULL,
  corrected_by INTEGER NOT NULL REFERENCES public.users(id),
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'applied',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT record_corrections_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT record_corrections_type_check CHECK (correction_type IN ('append_note', 'regulatory_correction', 'metadata_fix')),
  CONSTRAINT record_corrections_status_check CHECK (status IN ('applied'))
);

CREATE TABLE IF NOT EXISTS healthcare.access_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  actor_user_id INTEGER NOT NULL REFERENCES public.users(id),
  access_type VARCHAR(30) NOT NULL,
  target_table VARCHAR(80) NOT NULL,
  target_record_uuid UUID,
  target_business_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ip_address INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT access_audit_logs_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT access_audit_logs_type_check CHECK (access_type IN ('view', 'search', 'export', 'print', 'open_prescription', 'open_record'))
);

CREATE TABLE IF NOT EXISTS healthcare.privacy_consents (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  subject_type VARCHAR(20) NOT NULL,
  patient_id BIGINT,
  owner_id BIGINT,
  consent_type VARCHAR(40) NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  document_folio_id BIGINT,
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT privacy_consents_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT privacy_consents_subject_check CHECK (subject_type IN ('human', 'owner')),
  CONSTRAINT privacy_consents_type_check CHECK (consent_type IN ('privacy_notice', 'treatment', 'data_sharing', 'surgery', 'controlled_dispensing')),
  CONSTRAINT privacy_consents_status_check CHECK (status IN ('active', 'revoked', 'expired')),
  CONSTRAINT privacy_consents_subject_fk_check CHECK (
    (subject_type = 'human' AND patient_id IS NOT NULL AND owner_id IS NULL)
    OR
    (subject_type = 'owner' AND owner_id IS NOT NULL AND patient_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_patients_id_business
  ON healthcare.patients (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_clinical_encounters_id_business
  ON healthcare.clinical_encounters (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_prescriptions_id_business
  ON healthcare.prescriptions (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_prescription_items_id_business
  ON healthcare.prescription_items (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_pet_owners_id_business
  ON healthcare.pet_owners (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_pets_id_business
  ON healthcare.pets (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_veterinary_encounters_id_business
  ON healthcare.veterinary_encounters (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_medication_catalog_id_business
  ON healthcare.medication_catalog (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_inventory_batches_id_business
  ON healthcare.inventory_batches (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_dispensing_logs_id_business
  ON healthcare.dispensing_logs (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_document_folios_id_business
  ON healthcare.document_folios (id, business_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_clinical_encounters_patient'
      AND conrelid = 'healthcare.clinical_encounters'::regclass
  ) THEN
    ALTER TABLE healthcare.clinical_encounters
      ADD CONSTRAINT fk_healthcare_clinical_encounters_patient
      FOREIGN KEY (patient_id, business_id)
      REFERENCES healthcare.patients (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_vital_sign_records_encounter'
      AND conrelid = 'healthcare.vital_sign_records'::regclass
  ) THEN
    ALTER TABLE healthcare.vital_sign_records
      ADD CONSTRAINT fk_healthcare_vital_sign_records_encounter
      FOREIGN KEY (encounter_id, business_id)
      REFERENCES healthcare.clinical_encounters (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_vital_sign_records_patient'
      AND conrelid = 'healthcare.vital_sign_records'::regclass
  ) THEN
    ALTER TABLE healthcare.vital_sign_records
      ADD CONSTRAINT fk_healthcare_vital_sign_records_patient
      FOREIGN KEY (patient_id, business_id)
      REFERENCES healthcare.patients (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_clinical_notes_encounter'
      AND conrelid = 'healthcare.clinical_notes'::regclass
  ) THEN
    ALTER TABLE healthcare.clinical_notes
      ADD CONSTRAINT fk_healthcare_clinical_notes_encounter
      FOREIGN KEY (encounter_id, business_id)
      REFERENCES healthcare.clinical_encounters (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_clinical_notes_patient'
      AND conrelid = 'healthcare.clinical_notes'::regclass
  ) THEN
    ALTER TABLE healthcare.clinical_notes
      ADD CONSTRAINT fk_healthcare_clinical_notes_patient
      FOREIGN KEY (patient_id, business_id)
      REFERENCES healthcare.patients (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_clinical_notes_parent'
      AND conrelid = 'healthcare.clinical_notes'::regclass
  ) THEN
    ALTER TABLE healthcare.clinical_notes
      ADD CONSTRAINT fk_healthcare_clinical_notes_parent
      FOREIGN KEY (appended_to_note_id)
      REFERENCES healthcare.clinical_notes (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_diagnoses_encounter'
      AND conrelid = 'healthcare.diagnoses'::regclass
  ) THEN
    ALTER TABLE healthcare.diagnoses
      ADD CONSTRAINT fk_healthcare_diagnoses_encounter
      FOREIGN KEY (encounter_id, business_id)
      REFERENCES healthcare.clinical_encounters (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_diagnoses_patient'
      AND conrelid = 'healthcare.diagnoses'::regclass
  ) THEN
    ALTER TABLE healthcare.diagnoses
      ADD CONSTRAINT fk_healthcare_diagnoses_patient
      FOREIGN KEY (patient_id, business_id)
      REFERENCES healthcare.patients (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_prescriptions_patient'
      AND conrelid = 'healthcare.prescriptions'::regclass
  ) THEN
    ALTER TABLE healthcare.prescriptions
      ADD CONSTRAINT fk_healthcare_prescriptions_patient
      FOREIGN KEY (patient_id, business_id)
      REFERENCES healthcare.patients (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_prescriptions_clinical_encounter'
      AND conrelid = 'healthcare.prescriptions'::regclass
  ) THEN
    ALTER TABLE healthcare.prescriptions
      ADD CONSTRAINT fk_healthcare_prescriptions_clinical_encounter
      FOREIGN KEY (clinical_encounter_id, business_id)
      REFERENCES healthcare.clinical_encounters (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_prescription_items_prescription'
      AND conrelid = 'healthcare.prescription_items'::regclass
  ) THEN
    ALTER TABLE healthcare.prescription_items
      ADD CONSTRAINT fk_healthcare_prescription_items_prescription
      FOREIGN KEY (prescription_id, business_id)
      REFERENCES healthcare.prescriptions (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_prescription_items_product'
      AND conrelid = 'healthcare.prescription_items'::regclass
  ) THEN
    ALTER TABLE healthcare.prescription_items
      ADD CONSTRAINT fk_healthcare_prescription_items_product
      FOREIGN KEY (product_id, business_id)
      REFERENCES public.products (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_prescription_items_medication_catalog'
      AND conrelid = 'healthcare.prescription_items'::regclass
  ) THEN
    ALTER TABLE healthcare.prescription_items
      ADD CONSTRAINT fk_healthcare_prescription_items_medication_catalog
      FOREIGN KEY (medication_catalog_id, business_id)
      REFERENCES healthcare.medication_catalog (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_pet_owners_client'
      AND conrelid = 'healthcare.pet_owners'::regclass
  ) THEN
    ALTER TABLE healthcare.pet_owners
      ADD CONSTRAINT fk_healthcare_pet_owners_client
      FOREIGN KEY (client_id, business_id)
      REFERENCES public.clients (id, business_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_pets_owner'
      AND conrelid = 'healthcare.pets'::regclass
  ) THEN
    ALTER TABLE healthcare.pets
      ADD CONSTRAINT fk_healthcare_pets_owner
      FOREIGN KEY (owner_id, business_id)
      REFERENCES healthcare.pet_owners (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_veterinary_encounters_pet'
      AND conrelid = 'healthcare.veterinary_encounters'::regclass
  ) THEN
    ALTER TABLE healthcare.veterinary_encounters
      ADD CONSTRAINT fk_healthcare_veterinary_encounters_pet
      FOREIGN KEY (pet_id, business_id)
      REFERENCES healthcare.pets (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_veterinary_encounters_owner'
      AND conrelid = 'healthcare.veterinary_encounters'::regclass
  ) THEN
    ALTER TABLE healthcare.veterinary_encounters
      ADD CONSTRAINT fk_healthcare_veterinary_encounters_owner
      FOREIGN KEY (owner_id, business_id)
      REFERENCES healthcare.pet_owners (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_veterinary_notes_encounter'
      AND conrelid = 'healthcare.veterinary_notes'::regclass
  ) THEN
    ALTER TABLE healthcare.veterinary_notes
      ADD CONSTRAINT fk_healthcare_veterinary_notes_encounter
      FOREIGN KEY (veterinary_encounter_id, business_id)
      REFERENCES healthcare.veterinary_encounters (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_veterinary_notes_pet'
      AND conrelid = 'healthcare.veterinary_notes'::regclass
  ) THEN
    ALTER TABLE healthcare.veterinary_notes
      ADD CONSTRAINT fk_healthcare_veterinary_notes_pet
      FOREIGN KEY (pet_id, business_id)
      REFERENCES healthcare.pets (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_veterinary_notes_parent'
      AND conrelid = 'healthcare.veterinary_notes'::regclass
  ) THEN
    ALTER TABLE healthcare.veterinary_notes
      ADD CONSTRAINT fk_healthcare_veterinary_notes_parent
      FOREIGN KEY (appended_to_note_id)
      REFERENCES healthcare.veterinary_notes (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_veterinary_treatments_encounter'
      AND conrelid = 'healthcare.veterinary_treatments'::regclass
  ) THEN
    ALTER TABLE healthcare.veterinary_treatments
      ADD CONSTRAINT fk_healthcare_veterinary_treatments_encounter
      FOREIGN KEY (veterinary_encounter_id, business_id)
      REFERENCES healthcare.veterinary_encounters (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_veterinary_treatments_pet'
      AND conrelid = 'healthcare.veterinary_treatments'::regclass
  ) THEN
    ALTER TABLE healthcare.veterinary_treatments
      ADD CONSTRAINT fk_healthcare_veterinary_treatments_pet
      FOREIGN KEY (pet_id, business_id)
      REFERENCES healthcare.pets (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_veterinary_treatments_product'
      AND conrelid = 'healthcare.veterinary_treatments'::regclass
  ) THEN
    ALTER TABLE healthcare.veterinary_treatments
      ADD CONSTRAINT fk_healthcare_veterinary_treatments_product
      FOREIGN KEY (product_id, business_id)
      REFERENCES public.products (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_medication_catalog_product'
      AND conrelid = 'healthcare.medication_catalog'::regclass
  ) THEN
    ALTER TABLE healthcare.medication_catalog
      ADD CONSTRAINT fk_healthcare_medication_catalog_product
      FOREIGN KEY (product_id, business_id)
      REFERENCES public.products (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_inventory_batches_product'
      AND conrelid = 'healthcare.inventory_batches'::regclass
  ) THEN
    ALTER TABLE healthcare.inventory_batches
      ADD CONSTRAINT fk_healthcare_inventory_batches_product
      FOREIGN KEY (product_id, business_id)
      REFERENCES public.products (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_inventory_batches_medication_catalog'
      AND conrelid = 'healthcare.inventory_batches'::regclass
  ) THEN
    ALTER TABLE healthcare.inventory_batches
      ADD CONSTRAINT fk_healthcare_inventory_batches_medication_catalog
      FOREIGN KEY (medication_catalog_id, business_id)
      REFERENCES healthcare.medication_catalog (id, business_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_dispensing_logs_prescription'
      AND conrelid = 'healthcare.dispensing_logs'::regclass
  ) THEN
    ALTER TABLE healthcare.dispensing_logs
      ADD CONSTRAINT fk_healthcare_dispensing_logs_prescription
      FOREIGN KEY (prescription_id, business_id)
      REFERENCES healthcare.prescriptions (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_dispensing_logs_prescription_item'
      AND conrelid = 'healthcare.dispensing_logs'::regclass
  ) THEN
    ALTER TABLE healthcare.dispensing_logs
      ADD CONSTRAINT fk_healthcare_dispensing_logs_prescription_item
      FOREIGN KEY (prescription_item_id, business_id)
      REFERENCES healthcare.prescription_items (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_dispensing_logs_sale'
      AND conrelid = 'healthcare.dispensing_logs'::regclass
  ) THEN
    ALTER TABLE healthcare.dispensing_logs
      ADD CONSTRAINT fk_healthcare_dispensing_logs_sale
      FOREIGN KEY (sale_id, business_id)
      REFERENCES public.sales (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_dispensing_logs_product'
      AND conrelid = 'healthcare.dispensing_logs'::regclass
  ) THEN
    ALTER TABLE healthcare.dispensing_logs
      ADD CONSTRAINT fk_healthcare_dispensing_logs_product
      FOREIGN KEY (product_id, business_id)
      REFERENCES public.products (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_dispensing_logs_batch'
      AND conrelid = 'healthcare.dispensing_logs'::regclass
  ) THEN
    ALTER TABLE healthcare.dispensing_logs
      ADD CONSTRAINT fk_healthcare_dispensing_logs_batch
      FOREIGN KEY (batch_id, business_id)
      REFERENCES healthcare.inventory_batches (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_dispensing_logs_patient'
      AND conrelid = 'healthcare.dispensing_logs'::regclass
  ) THEN
    ALTER TABLE healthcare.dispensing_logs
      ADD CONSTRAINT fk_healthcare_dispensing_logs_patient
      FOREIGN KEY (patient_id, business_id)
      REFERENCES healthcare.patients (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_dispensing_logs_pet'
      AND conrelid = 'healthcare.dispensing_logs'::regclass
  ) THEN
    ALTER TABLE healthcare.dispensing_logs
      ADD CONSTRAINT fk_healthcare_dispensing_logs_pet
      FOREIGN KEY (pet_id, business_id)
      REFERENCES healthcare.pets (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_antibiotic_dispensing_logs_dispensing'
      AND conrelid = 'healthcare.antibiotic_dispensing_logs'::regclass
  ) THEN
    ALTER TABLE healthcare.antibiotic_dispensing_logs
      ADD CONSTRAINT fk_healthcare_antibiotic_dispensing_logs_dispensing
      FOREIGN KEY (dispensing_log_id, business_id)
      REFERENCES healthcare.dispensing_logs (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_antibiotic_dispensing_logs_prescription'
      AND conrelid = 'healthcare.antibiotic_dispensing_logs'::regclass
  ) THEN
    ALTER TABLE healthcare.antibiotic_dispensing_logs
      ADD CONSTRAINT fk_healthcare_antibiotic_dispensing_logs_prescription
      FOREIGN KEY (prescription_id, business_id)
      REFERENCES healthcare.prescriptions (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_controlled_ledger_product'
      AND conrelid = 'healthcare.controlled_substance_ledger'::regclass
  ) THEN
    ALTER TABLE healthcare.controlled_substance_ledger
      ADD CONSTRAINT fk_healthcare_controlled_ledger_product
      FOREIGN KEY (product_id, business_id)
      REFERENCES public.products (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_controlled_ledger_batch'
      AND conrelid = 'healthcare.controlled_substance_ledger'::regclass
  ) THEN
    ALTER TABLE healthcare.controlled_substance_ledger
      ADD CONSTRAINT fk_healthcare_controlled_ledger_batch
      FOREIGN KEY (batch_id, business_id)
      REFERENCES healthcare.inventory_batches (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_controlled_ledger_dispensing'
      AND conrelid = 'healthcare.controlled_substance_ledger'::regclass
  ) THEN
    ALTER TABLE healthcare.controlled_substance_ledger
      ADD CONSTRAINT fk_healthcare_controlled_ledger_dispensing
      FOREIGN KEY (related_dispensing_log_id, business_id)
      REFERENCES healthcare.dispensing_logs (id, business_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_prescriptions_veterinary_encounter'
      AND conrelid = 'healthcare.prescriptions'::regclass
  ) THEN
    ALTER TABLE healthcare.prescriptions
      ADD CONSTRAINT fk_healthcare_prescriptions_veterinary_encounter
      FOREIGN KEY (veterinary_encounter_id, business_id)
      REFERENCES healthcare.veterinary_encounters (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_prescriptions_pet'
      AND conrelid = 'healthcare.prescriptions'::regclass
  ) THEN
    ALTER TABLE healthcare.prescriptions
      ADD CONSTRAINT fk_healthcare_prescriptions_pet
      FOREIGN KEY (pet_id, business_id)
      REFERENCES healthcare.pets (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_prescriptions_document_folio'
      AND conrelid = 'healthcare.prescriptions'::regclass
  ) THEN
    ALTER TABLE healthcare.prescriptions
      ADD CONSTRAINT fk_healthcare_prescriptions_document_folio
      FOREIGN KEY (document_folio_id, business_id)
      REFERENCES healthcare.document_folios (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_privacy_consents_patient'
      AND conrelid = 'healthcare.privacy_consents'::regclass
  ) THEN
    ALTER TABLE healthcare.privacy_consents
      ADD CONSTRAINT fk_healthcare_privacy_consents_patient
      FOREIGN KEY (patient_id, business_id)
      REFERENCES healthcare.patients (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_privacy_consents_owner'
      AND conrelid = 'healthcare.privacy_consents'::regclass
  ) THEN
    ALTER TABLE healthcare.privacy_consents
      ADD CONSTRAINT fk_healthcare_privacy_consents_owner
      FOREIGN KEY (owner_id, business_id)
      REFERENCES healthcare.pet_owners (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_privacy_consents_document_folio'
      AND conrelid = 'healthcare.privacy_consents'::regclass
  ) THEN
    ALTER TABLE healthcare.privacy_consents
      ADD CONSTRAINT fk_healthcare_privacy_consents_document_folio
      FOREIGN KEY (document_folio_id, business_id)
      REFERENCES healthcare.document_folios (id, business_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_healthcare_business_modules_enabled
  ON healthcare.business_modules (business_id, enabled, module_key);

CREATE INDEX IF NOT EXISTS idx_healthcare_patients_lookup
  ON healthcare.patients (business_id, is_active, LOWER(first_name), LOWER(last_name));

CREATE INDEX IF NOT EXISTS idx_healthcare_clinical_encounters_patient_date
  ON healthcare.clinical_encounters (business_id, patient_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_vital_sign_records_patient_date
  ON healthcare.vital_sign_records (business_id, patient_id, measured_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_clinical_notes_encounter_date
  ON healthcare.clinical_notes (business_id, encounter_id, authored_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_diagnoses_patient
  ON healthcare.diagnoses (business_id, patient_id, diagnosed_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_prescriptions_subject
  ON healthcare.prescriptions (business_id, subject_type, prescription_date DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_prescription_items_prescription
  ON healthcare.prescription_items (business_id, prescription_id, line_number);

CREATE INDEX IF NOT EXISTS idx_healthcare_pet_owners_lookup
  ON healthcare.pet_owners (business_id, is_active, LOWER(first_name), LOWER(last_name));

CREATE INDEX IF NOT EXISTS idx_healthcare_pets_lookup
  ON healthcare.pets (business_id, owner_id, is_active, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_healthcare_veterinary_encounters_pet_date
  ON healthcare.veterinary_encounters (business_id, pet_id, encounter_date DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_veterinary_notes_encounter_date
  ON healthcare.veterinary_notes (business_id, veterinary_encounter_id, authored_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_medication_catalog_flags
  ON healthcare.medication_catalog (business_id, is_antibiotic, is_controlled_substance, is_active);

CREATE INDEX IF NOT EXISTS idx_healthcare_inventory_batches_product_expiry
  ON healthcare.inventory_batches (business_id, product_id, expiry_date, quantity_available);

CREATE INDEX IF NOT EXISTS idx_healthcare_dispensing_logs_product_date
  ON healthcare.dispensing_logs (business_id, product_id, dispensed_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_dispensing_logs_sale
  ON healthcare.dispensing_logs (business_id, sale_id);

CREATE INDEX IF NOT EXISTS idx_healthcare_antibiotic_dispensing_logs_date
  ON healthcare.antibiotic_dispensing_logs (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_controlled_substance_ledger_product_date
  ON healthcare.controlled_substance_ledger (business_id, product_id, movement_date DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_temperature_humidity_logs_area_date
  ON healthcare.temperature_humidity_logs (business_id, area_code, measured_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_document_folios_lookup
  ON healthcare.document_folios (business_id, document_type, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_record_corrections_target
  ON healthcare.record_corrections (business_id, target_table, target_record_uuid, corrected_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_access_audit_logs_target
  ON healthcare.access_audit_logs (business_id, target_table, target_record_uuid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_access_audit_logs_actor
  ON healthcare.access_audit_logs (business_id, actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_privacy_consents_subject
  ON healthcare.privacy_consents (business_id, subject_type, granted_at DESC);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'business_modules',
    'patients',
    'clinical_encounters',
    'vital_sign_records',
    'clinical_notes',
    'diagnoses',
    'prescriptions',
    'prescription_items',
    'pet_owners',
    'pets',
    'veterinary_encounters',
    'veterinary_notes',
    'veterinary_treatments',
    'medication_catalog',
    'inventory_batches',
    'dispensing_logs',
    'antibiotic_dispensing_logs',
    'controlled_substance_ledger',
    'temperature_humidity_logs',
    'document_folios',
    'record_corrections',
    'access_audit_logs',
    'privacy_consents'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'trg_' || table_name || '_touch_updated_at'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON healthcare.%I FOR EACH ROW EXECUTE FUNCTION healthcare.touch_updated_at()',
        'trg_' || table_name || '_touch_updated_at',
        table_name
      );
    END IF;
  END LOOP;
END $$;

INSERT INTO healthcare.business_modules (business_id, module_key, enabled, activated_at, created_at, updated_at)
SELECT b.id, module_key, enabled, NOW(), NOW(), NOW()
FROM public.businesses b
JOIN (
  VALUES
    ('clinical_core', FALSE),
    ('clinical_human', FALSE),
    ('clinical_dental', FALSE),
    ('veterinary_core', FALSE),
    ('pharmacy_core', FALSE),
    ('pharmacy_regulatory', FALSE),
    ('prescriptions', FALSE),
    ('dispensing', FALSE),
    ('inventory_batches', FALSE),
    ('temperature_humidity', FALSE),
    ('privacy_consents', TRUE)
) AS defaults(module_key, enabled) ON TRUE
ON CONFLICT (business_id, module_key) DO NOTHING;

CREATE OR REPLACE VIEW healthcare.view_libro_antibioticos AS
SELECT
  dl.dispensed_at AS fecha_dispensacion,
  p.name AS producto,
  mc.active_ingredient AS sustancia_activa,
  ib.batch_number AS lote_numero,
  ib.expiry_date AS fecha_caducidad,
  dl.dispensed_quantity AS cantidad_dispensada,
  adl.physician_name AS nombre_medico,
  adl.physician_license AS cedula_profesional,
  pr.folio_uuid AS receta_folio,
  dl.folio_uuid AS dispensacion_folio,
  dl.business_id
FROM healthcare.antibiotic_dispensing_logs adl
INNER JOIN healthcare.dispensing_logs dl
  ON dl.id = adl.dispensing_log_id
 AND dl.business_id = adl.business_id
INNER JOIN public.products p
  ON p.id = dl.product_id
 AND p.business_id = dl.business_id
LEFT JOIN healthcare.medication_catalog mc
  ON mc.product_id = dl.product_id
 AND mc.business_id = dl.business_id
LEFT JOIN healthcare.inventory_batches ib
  ON ib.id = dl.batch_id
 AND ib.business_id = dl.business_id
LEFT JOIN healthcare.prescriptions pr
  ON pr.id = dl.prescription_id
 AND pr.business_id = dl.business_id;
