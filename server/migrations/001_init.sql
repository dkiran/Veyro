CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text NOT NULL DEFAULT 'IN',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','manager','viewer')),
  locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  license_number text,
  license_expiry date,
  preferred_language text NOT NULL DEFAULT 'en',  -- for WhatsApp / voice agents later
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drivers_org ON drivers(org_id);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reg_number text NOT NULL,
  name text,
  type text NOT NULL DEFAULT 'truck' CHECK (type IN ('car','truck','bus','van','bike','tractor','other')),
  make text, model text, year int,
  fuel_type text NOT NULL DEFAULT 'diesel' CHECK (fuel_type IN ('diesel','petrol','cng','electric','hybrid','other')),
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','maintenance')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, reg_number)
);
CREATE INDEX vehicles_org ON vehicles(org_id);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  imei text NOT NULL UNIQUE,
  model text,
  protocol text NOT NULL DEFAULT 'http-json',
  sim_number text,
  api_key text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  vehicle_id uuid UNIQUE REFERENCES vehicles(id) ON DELETE SET NULL,
  last_seen timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_org ON devices(org_id);

-- Raw GPS history. Candidate for time partitioning (pg_partman/native) once volume grows.
CREATE TABLE positions (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  speed_kmh real NOT NULL DEFAULT 0,
  heading real,
  altitude real,
  ignition boolean,
  attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (vehicle_id, ts)
);
CREATE INDEX positions_org_ts ON positions(org_id, ts);

-- Latest known state per vehicle (fast live-map snapshot).
CREATE TABLE vehicle_state (
  vehicle_id uuid PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  ts timestamptz NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed_kmh real NOT NULL DEFAULT 0,
  heading real,
  ignition boolean,
  idle_since timestamptz,
  odometer_km double precision NOT NULL DEFAULT 0
);
CREATE INDEX vehicle_state_org ON vehicle_state(org_id);

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  start_ts timestamptz NOT NULL,
  end_ts timestamptz,
  start_lat double precision NOT NULL, start_lng double precision NOT NULL,
  end_lat double precision, end_lng double precision,
  distance_km double precision NOT NULL DEFAULT 0,
  max_speed_kmh real NOT NULL DEFAULT 0
);
CREATE INDEX trips_vehicle_start ON trips(vehicle_id, start_ts DESC);
CREATE UNIQUE INDEX trips_one_open_per_vehicle ON trips(vehicle_id) WHERE end_ts IS NULL;
