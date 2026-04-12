import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN custom_indicator_json TEXT
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN custom_indicator_json TEXT
  `;
});
