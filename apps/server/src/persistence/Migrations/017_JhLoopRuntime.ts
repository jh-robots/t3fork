import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS jh_loop_definitions (
      loop_id TEXT PRIMARY KEY,
      job_key TEXT NOT NULL UNIQUE,
      loop_type TEXT NOT NULL,
      runtime_project_id TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      project_title TEXT NOT NULL,
      objective TEXT NOT NULL,
      completion_criteria TEXT NOT NULL,
      requested_state TEXT,
      enabled INTEGER NOT NULL,
      worker_model TEXT NOT NULL,
      supervisor_model TEXT NOT NULL,
      worker_runtime_mode TEXT,
      worker_interaction_mode TEXT,
      supervisor_runtime_mode TEXT,
      supervisor_interaction_mode TEXT,
      supervisor_thread_id TEXT,
      worker_thread_ids_json TEXT NOT NULL,
      worker_specs_json TEXT NOT NULL,
      source TEXT,
      interval_seconds INTEGER NOT NULL,
      active_poll_seconds INTEGER NOT NULL,
      fast_chain_window_ms INTEGER NOT NULL,
      fast_chain_max_transitions INTEGER NOT NULL,
      stop_when_worker_deleted INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS jh_loop_runtime_state (
      loop_id TEXT PRIMARY KEY,
      phase TEXT NOT NULL,
      completed INTEGER NOT NULL,
      last_run_at TEXT,
      next_run_at TEXT,
      last_heartbeat_at TEXT,
      last_summary TEXT,
      last_error TEXT,
      execution_count INTEGER NOT NULL,
      worker_thread_title TEXT,
      supervisor_thread_title TEXT,
      worker_thread_id TEXT,
      supervisor_thread_id TEXT,
      last_worker_assistant_summary TEXT,
      last_supervisor_decision TEXT,
      last_observed_turn_id TEXT,
      last_forward_progress_at TEXT,
      stopped_reason TEXT,
      active_worker_key TEXT,
      next_worker_index INTEGER NOT NULL,
      worker_roster_json TEXT NOT NULL,
      ignored_control_message_keys_json TEXT NOT NULL,
      ignored_control_message_fingerprints_json TEXT NOT NULL,
      last_control_message_key TEXT,
      last_human_control_text TEXT,
      last_human_control_at TEXT,
      last_human_control_instruction TEXT,
      startup_ensured INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (loop_id) REFERENCES jh_loop_definitions(loop_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_jh_loop_definitions_job_key
    ON jh_loop_definitions(job_key)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_jh_loop_definitions_runtime_project_id
    ON jh_loop_definitions(runtime_project_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_jh_loop_runtime_state_next_run_at
    ON jh_loop_runtime_state(next_run_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_jh_loop_runtime_state_phase
    ON jh_loop_runtime_state(phase)
  `;
});
