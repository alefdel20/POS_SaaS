CREATE TABLE IF NOT EXISTS alert_configs (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  alert_type VARCHAR(50) NOT NULL,
  threshold_days INT NOT NULL DEFAULT 21,
  notification_channels JSONB NOT NULL DEFAULT '["whatsapp"]',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_alert_configs_business ON alert_configs(business_id);
