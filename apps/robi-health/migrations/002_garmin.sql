CREATE TABLE garmin_daily_health (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), local_date date NOT NULL, timezone text NOT NULL,
 sleep_duration_minutes numeric, sleep_score numeric, hrv numeric, resting_hr numeric, average_stress numeric,
 body_battery_start numeric, body_battery_end numeric, body_battery_high numeric, body_battery_low numeric,
 training_readiness numeric, training_status text, training_load numeric, steps integer,
 source_updated_at timestamptz, raw_metadata jsonb NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(user_id,local_date)
);
CREATE TABLE workouts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), source text NOT NULL,
 external_activity_id text, sport text NOT NULL, started_at timestamptz NOT NULL,
 duration_seconds numeric, distance_meters numeric, calories numeric, avg_hr numeric, max_hr numeric,
 avg_speed numeric, avg_pace numeric, elevation_gain numeric, cadence numeric, training_load numeric,
 aerobic_training_effect numeric, anaerobic_training_effect numeric, raw_metadata jsonb NOT NULL DEFAULT '{}',
 user_overrides jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(user_id,source,external_activity_id)
);
CREATE INDEX workouts_user_started ON workouts(user_id,started_at DESC);
CREATE TABLE workout_splits (
 workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE, split_index integer NOT NULL,
 distance_meters numeric, duration_seconds numeric, avg_hr numeric, avg_speed numeric,
 raw_metadata jsonb NOT NULL, PRIMARY KEY(workout_id,split_index)
);
CREATE TABLE workout_hr_zones (
 workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE, zone_number integer NOT NULL,
 duration_seconds numeric, low_boundary numeric, raw_metadata jsonb NOT NULL, PRIMARY KEY(workout_id,zone_number)
);
CREATE TABLE workout_sets (
 workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE, set_index integer NOT NULL,
 exercise text, set_type text, reps integer, weight_kg numeric, duration_seconds numeric,
 raw_metadata jsonb NOT NULL, PRIMARY KEY(workout_id,set_index)
);
CREATE TABLE garmin_sync_state (
 user_id uuid NOT NULL REFERENCES users(id), resource_type text NOT NULL,
 last_successful_sync_at timestamptz, last_source_timestamp timestamptz,
 last_error_at timestamptz, last_error_code text, PRIMARY KEY(user_id,resource_type)
);
REVOKE ALL ON garmin_daily_health,workouts,workout_splits,workout_hr_zones,workout_sets,garmin_sync_state FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON garmin_daily_health,workouts,garmin_sync_state TO robi_db_user;
GRANT SELECT,INSERT,UPDATE,DELETE ON workout_splits,workout_hr_zones,workout_sets TO robi_db_user;
