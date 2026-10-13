-- MES LION 1.0 PGSQL — extensões aditivas, não apagam dados
CREATE TABLE IF NOT EXISTS equipment_scales (
 equipment_code varchar(100) NOT NULL REFERENCES equipment(code),
 scale varchar(40) NOT NULL CHECK (scale IN ('Piloto','Industrial','Testes de Caracterização')),
 cell_type varchar(40) NOT NULL DEFAULT 'Geral',
 PRIMARY KEY(equipment_code,scale,cell_type)
);
CREATE TABLE IF NOT EXISTS characterization_bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 equipment_code varchar(100) NOT NULL REFERENCES equipment(code),
 starts_at timestamp NOT NULL, ends_at timestamp NOT NULL,
 description text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at)
);
CREATE TABLE IF NOT EXISTS capacity_restrictions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 equipment_code varchar(100) REFERENCES equipment(code),
 scale varchar(40) NOT NULL,
 starts_at timestamp NOT NULL, ends_at timestamp NOT NULL,
 reason text NOT NULL, source_batch text,
 CHECK(ends_at>starts_at)
);
CREATE TABLE IF NOT EXISTS planning_goals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scale varchar(40) NOT NULL, goal_date date NOT NULL,
 description text NOT NULL, status varchar(30) NOT NULL DEFAULT 'PLANEJADA'
);
CREATE TABLE IF NOT EXISTS setup_time_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 op_code varchar(120) REFERENCES production_orders(code),
 equipment_code varchar(100) REFERENCES equipment(code),
 minutes numeric NOT NULL CHECK(minutes>=0),
 logged_at timestamptz NOT NULL DEFAULT now(),
 notes text
);
CREATE TABLE IF NOT EXISTS stock_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 material_code varchar(100) NOT NULL,
 movement_type varchar(30) NOT NULL,
 quantity numeric NOT NULL CHECK(quantity>0),
 unit varchar(30) NOT NULL,
 origin_type varchar(40) NOT NULL,
 origin_id text NOT NULL,
 lot text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(origin_type,origin_id,material_code,movement_type,lot)
);
CREATE INDEX IF NOT EXISTS idx_stock_material ON stock_movements(material_code,created_at);
CREATE INDEX IF NOT EXISTS idx_capacity_scale_time ON capacity_restrictions(scale,starts_at);
