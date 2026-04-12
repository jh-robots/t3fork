import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE jh_loop_runtime_state
    ADD COLUMN last_consumed_supervisor_message_id TEXT
  `;

  yield* sql`
    ALTER TABLE jh_loop_runtime_state
    ADD COLUMN pending_worker_prompt_message_id TEXT
  `;
});
