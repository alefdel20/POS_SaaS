INSERT INTO users (username, email, full_name, password_hash, role, is_active)
VALUES
  ('admin', 'admin@pos.local', 'Administrador General', crypt('Admin123*', gen_salt('bf', 10)), 'superusuario', TRUE),
  ('cajero', 'cajero@pos.local', 'Caja Principal', crypt('Cajero123*', gen_salt('bf', 10)), 'cajero', TRUE)
ON CONFLICT (username) DO NOTHING;

INSERT INTO company_profiles (profile_key, general_settings, is_active)
SELECT 'default', '{}'::jsonb, TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM company_profiles
  WHERE profile_key = 'default'
);

INSERT INTO products (name, sku, barcode, category, description, price, cost_price, stock, is_active)
SELECT * FROM (
  VALUES
    ('Cafe Americano', 'CAF-001', '750000000001', 'Bebidas', 'Bebida caliente mediana', 35.00, 14.00, 40, TRUE),
    ('Sandwich de Jamon', 'FOOD-001', '750000000002', 'Alimentos', 'Sandwich fresco para mostrador', 58.00, 26.00, 18, TRUE),
    ('Refresco Lata', 'DRK-001', '750000000003', 'Bebidas', 'Refresco de 355 ml', 22.00, 10.00, 60, TRUE),
    ('Galletas', 'SNK-001', '750000000004', 'Snacks', 'Paquete individual', 18.00, 8.00, 24, TRUE),
    ('Botella de Agua', 'DRK-002', '750000000005', 'Bebidas', 'Agua natural 600 ml', 16.00, 7.00, 50, TRUE)
) AS demo_products(name, sku, barcode, category, description, price, cost_price, stock, is_active)
WHERE NOT EXISTS (SELECT 1 FROM products LIMIT 1);

INSERT INTO reminders (title, notes, status, due_date, assigned_to, created_by, is_completed)
SELECT 'Revisar corte nocturno', 'Confirmar caja y terminal antes de cerrar.', 'pending', CURRENT_DATE, u2.id, u1.id, FALSE
FROM users u1, users u2
WHERE u1.username = 'admin'
  AND u2.username = 'cajero'
  AND NOT EXISTS (SELECT 1 FROM reminders WHERE title = 'Revisar corte nocturno');

INSERT INTO reminders (title, notes, status, due_date, assigned_to, created_by, is_completed)
SELECT 'Actualizar precios de temporada', 'Validar nuevos costos con proveedor.', 'in_progress', CURRENT_DATE + INTERVAL '2 day', u1.id, u1.id, FALSE
FROM users u1
WHERE u1.username = 'admin'
  AND NOT EXISTS (SELECT 1 FROM reminders WHERE title = 'Actualizar precios de temporada');

DO $$
DECLARE
  admin_id INTEGER;
  existing_sale_id INTEGER;
BEGIN
  SELECT id INTO admin_id FROM users WHERE username = 'admin';
  SELECT id INTO existing_sale_id FROM sales LIMIT 1;

  IF admin_id IS NOT NULL AND existing_sale_id IS NULL THEN
    INSERT INTO sales (user_id, payment_method, sale_type, subtotal, total, total_cost, notes, sale_date, sale_time)
    VALUES (admin_id, 'cash', 'ticket', 93.00, 93.00, 40.00, 'Venta de ejemplo', CURRENT_DATE, CURRENT_TIME)
    RETURNING id INTO existing_sale_id;

    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, subtotal)
    SELECT existing_sale_id, id, 1, price, cost_price, price
    FROM products
    WHERE sku IN ('CAF-001', 'FOOD-001');

    UPDATE products SET stock = stock - 1 WHERE sku IN ('CAF-001', 'FOOD-001');

    INSERT INTO daily_cuts (cut_date, total_day, cash_total, card_total, credit_total, transfer_total, invoice_count, ticket_count, gross_profit, gross_margin)
    VALUES (CURRENT_DATE, 93.00, 93.00, 0, 0, 0, 0, 1, 53.00, 56.99)
    ON CONFLICT (cut_date) DO NOTHING;
  END IF;
END $$;
