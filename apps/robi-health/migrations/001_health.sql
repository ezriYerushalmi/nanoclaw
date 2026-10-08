CREATE TABLE users (
  id uuid PRIMARY KEY,
  external_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  timezone text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE weight_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  weight_kg numeric(6,2) NOT NULL CHECK (weight_kg >= 10 AND weight_kg <= 500),
  measured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  source text NOT NULL,
  source_message_id text,
  idempotency_key text NOT NULL,
  previous_weight_kg numeric(6,2),
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX weight_user_measured ON weight_entries(user_id, measured_at DESC, created_at DESC, id DESC);
CREATE TABLE water_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  amount_ml integer NOT NULL CHECK (amount_ml > 0 AND amount_ml <= 100000),
  consumed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  source text NOT NULL,
  source_message_id text,
  idempotency_key text NOT NULL,
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX water_user_consumed ON water_entries(user_id, consumed_at);
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE robi_db TO robi_db_user;
GRANT USAGE ON SCHEMA public TO robi_db_user;
GRANT SELECT ON users TO robi_db_user;
GRANT SELECT, INSERT ON weight_entries, water_entries TO robi_db_user;
