ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

COMMENT ON COLUMN business_subscriptions.trial_ends_at IS 'Fin del período de prueba gratuita. NULL = sin trial. Solo aplica a negocios creados desde el panel admin.';
COMMENT ON COLUMN business_subscriptions.trial_started_at IS 'Inicio del período de prueba gratuita.';
