CREATE TABLE IF NOT EXISTS patients (
  id SERIAL PRIMARY KEY,
  business_id INTEGER,
  client_id INTEGER NOT NULL,
  name VARCHAR(150) NOT NULL,
  species VARCHAR(120),
  breed VARCHAR(120),
  sex VARCHAR(20),
  birth_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultations (
  id SERIAL PRIMARY KEY,
  business_id INTEGER,
  patient_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  consultation_date TIMESTAMP NOT NULL DEFAULT NOW(),
  motivo_consulta TEXT NOT NULL DEFAULT '',
  diagnostico TEXT NOT NULL DEFAULT '',
  tratamiento TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  business_id INTEGER,
  patient_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  area VARCHAR(20) NOT NULL DEFAULT 'CLINICA',
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);

ALTER TABLE patients ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS client_id INTEGER;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS name VARCHAR(150);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS species VARCHAR(120);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS breed VARCHAR(120);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS sex VARCHAR(20);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE patients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE consultations ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS patient_id INTEGER;
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS client_id INTEGER;
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS consultation_date TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS motivo_consulta TEXT NOT NULL DEFAULT '';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS diagnostico TEXT NOT NULL DEFAULT '';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS tratamiento TEXT NOT NULL DEFAULT '';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS notas TEXT NOT NULL DEFAULT '';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_id INTEGER;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_id INTEGER;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_date DATE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS area VARCHAR(20) NOT NULL DEFAULT 'CLINICA';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'scheduled';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

DO $$
DECLARE
  fallback_business_id INTEGER;
BEGIN
  SELECT id
  INTO fallback_business_id
  FROM businesses
  WHERE slug = 'default'
  ORDER BY id ASC
  LIMIT 1;

  IF fallback_business_id IS NULL THEN
    SELECT id
    INTO fallback_business_id
    FROM businesses
    ORDER BY id ASC
    LIMIT 1;
  END IF;

  IF fallback_business_id IS NOT NULL THEN
    UPDATE clients
    SET business_id = fallback_business_id
    WHERE business_id IS NULL;
  END IF;

  UPDATE patients p
  SET business_id = COALESCE(p.business_id, c.business_id, fallback_business_id)
  FROM clients c
  WHERE c.id = p.client_id
    AND p.business_id IS NULL;

  UPDATE consultations mc
  SET business_id = COALESCE(mc.business_id, p.business_id, c.business_id, fallback_business_id),
      client_id = COALESCE(mc.client_id, p.client_id)
  FROM patients p
  LEFT JOIN clients c ON c.id = p.client_id
  WHERE p.id = mc.patient_id
    AND (mc.business_id IS NULL OR mc.client_id IS NULL);

  UPDATE appointments ma
  SET business_id = COALESCE(ma.business_id, p.business_id, c.business_id, fallback_business_id),
      client_id = COALESCE(ma.client_id, p.client_id)
  FROM patients p
  LEFT JOIN clients c ON c.id = p.client_id
  WHERE p.id = ma.patient_id
    AND (ma.business_id IS NULL OR ma.client_id IS NULL);
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_clients_business'
      AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE clients
    ADD CONSTRAINT fk_clients_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_patients_business'
      AND conrelid = 'patients'::regclass
  ) THEN
    ALTER TABLE patients
    ADD CONSTRAINT fk_patients_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_consultations_business'
      AND conrelid = 'consultations'::regclass
  ) THEN
    ALTER TABLE consultations
    ADD CONSTRAINT fk_consultations_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_appointments_business'
      AND conrelid = 'appointments'::regclass
  ) THEN
    ALTER TABLE appointments
    ADD CONSTRAINT fk_appointments_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_area_check'
      AND conrelid = 'appointments'::regclass
  ) THEN
    ALTER TABLE appointments
    ADD CONSTRAINT appointments_area_check
    CHECK (area IN ('CLINICA', 'ESTETICA'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_status_check'
      AND conrelid = 'appointments'::regclass
  ) THEN
    ALTER TABLE appointments
    ADD CONSTRAINT appointments_status_check
    CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_time_check'
      AND conrelid = 'appointments'::regclass
  ) THEN
    ALTER TABLE appointments
    ADD CONSTRAINT appointments_time_check
    CHECK (end_time > start_time);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients WHERE business_id IS NULL) THEN
    ALTER TABLE clients ALTER COLUMN business_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM patients WHERE business_id IS NULL) THEN
    ALTER TABLE patients ALTER COLUMN business_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM consultations WHERE business_id IS NULL) THEN
    ALTER TABLE consultations ALTER COLUMN business_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM appointments WHERE business_id IS NULL) THEN
    ALTER TABLE appointments ALTER COLUMN business_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM consultations WHERE client_id IS NULL) THEN
    ALTER TABLE consultations ALTER COLUMN client_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM appointments WHERE client_id IS NULL) THEN
    ALTER TABLE appointments ALTER COLUMN client_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_business_id_active_name
  ON clients (business_id, is_active, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_clients_business_phone
  ON clients (business_id, phone);

CREATE INDEX IF NOT EXISTS idx_clients_business_email
  ON clients (business_id, email);

CREATE INDEX IF NOT EXISTS idx_patients_business_id_active_name
  ON patients (business_id, is_active, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_patients_client_id
  ON patients (business_id, client_id);

CREATE INDEX IF NOT EXISTS idx_consultations_business_patient_date
  ON consultations (business_id, patient_id, consultation_date DESC);

CREATE INDEX IF NOT EXISTS idx_consultations_business_client_date
  ON consultations (business_id, client_id, consultation_date DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_business_date_area
  ON appointments (business_id, appointment_date, area, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_appointments_business_patient_date
  ON appointments (business_id, patient_id, appointment_date DESC);
