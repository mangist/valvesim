-- Valvesim database schema (PostgreSQL 16+)

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- Saved schematics: full canvas state stored as JSONB
CREATE TABLE IF NOT EXISTS designs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    schematic   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS designs_updated_at_idx ON designs (updated_at DESC);
CREATE INDEX IF NOT EXISTS designs_schematic_gin ON designs USING gin (schematic);

-- Component library: schematic symbols + SPICE models
-- (e.g. 5U4G rectifier tube, Hammond 372HX power transformer)
CREATE TABLE IF NOT EXISTS components (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        text NOT NULL,              -- 'tube' | 'transformer' | 'resistor' | ...
    name        text NOT NULL UNIQUE,       -- '5U4G', 'Hammond 372HX', ...
    manufacturer text,
    symbol_svg  text,                       -- flat 2D labeled-pin illustration
    pin_map     jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{id, name, net_hint}, ...]
    spice_model text,                       -- .model / .subckt definition
    params      jsonb NOT NULL DEFAULT '{}'::jsonb, -- default editable parameters
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS components_kind_idx ON components (kind);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS designs_set_updated_at ON designs;
CREATE TRIGGER designs_set_updated_at
    BEFORE UPDATE ON designs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
