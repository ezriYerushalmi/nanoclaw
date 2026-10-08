CREATE TABLE workout_analysis_events (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 workout_id uuid NOT NULL REFERENCES workouts(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
 created_at timestamptz NOT NULL,
 completed_at timestamptz,
 UNIQUE(user_id,workout_id)
);
REVOKE ALL ON workout_analysis_events FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON workout_analysis_events TO robi_db_user;
