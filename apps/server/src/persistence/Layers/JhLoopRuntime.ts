import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  GetJhLoopByIdInput,
  GetJhLoopByJobKeyInput,
  JhLoopDefinition,
  JhLoopRecord,
  JhLoopRuntimeRepository,
  JhLoopRuntimeState,
  type JhLoopRuntimeRepositoryShape,
} from "../Services/JhLoopRuntime.ts";

const JhLoopDefinitionDbRowSchema = JhLoopDefinition.mapFields(
  Struct.assign({
    workerThreadIds: Schema.fromJsonString(JhLoopDefinition.fields.workerThreadIds),
    workerSpecs: Schema.fromJsonString(JhLoopDefinition.fields.workerSpecs),
  }),
);

const JhLoopRuntimeStateDbRowSchema = JhLoopRuntimeState.mapFields(
  Struct.assign({
    workerRoster: Schema.fromJsonString(JhLoopRuntimeState.fields.workerRoster),
    ignoredControlMessageKeys: Schema.fromJsonString(
      JhLoopRuntimeState.fields.ignoredControlMessageKeys,
    ),
    ignoredControlMessageFingerprints: Schema.fromJsonString(
      JhLoopRuntimeState.fields.ignoredControlMessageFingerprints,
    ),
  }),
);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeJhLoopRuntimeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const JoinedLoopQueryResultSchema = Schema.Struct({
    loopId: JhLoopDefinition.fields.loopId,
    jobKey: JhLoopDefinitionDbRowSchema.fields.jobKey,
    loopType: JhLoopDefinitionDbRowSchema.fields.loopType,
    runtimeProjectId: JhLoopDefinitionDbRowSchema.fields.runtimeProjectId,
    workspaceRoot: JhLoopDefinitionDbRowSchema.fields.workspaceRoot,
    projectTitle: JhLoopDefinitionDbRowSchema.fields.projectTitle,
    objective: JhLoopDefinitionDbRowSchema.fields.objective,
    completionCriteria: JhLoopDefinitionDbRowSchema.fields.completionCriteria,
    requestedState: JhLoopDefinitionDbRowSchema.fields.requestedState,
    enabled: Schema.Number,
    workerModel: JhLoopDefinitionDbRowSchema.fields.workerModel,
    supervisorModel: JhLoopDefinitionDbRowSchema.fields.supervisorModel,
    workerRuntimeMode: JhLoopDefinitionDbRowSchema.fields.workerRuntimeMode,
    workerInteractionMode: JhLoopDefinitionDbRowSchema.fields.workerInteractionMode,
    supervisorRuntimeMode: JhLoopDefinitionDbRowSchema.fields.supervisorRuntimeMode,
    supervisorInteractionMode: JhLoopDefinitionDbRowSchema.fields.supervisorInteractionMode,
    definitionSupervisorThreadId: JhLoopDefinitionDbRowSchema.fields.supervisorThreadId,
    workerThreadIds: JhLoopDefinitionDbRowSchema.fields.workerThreadIds,
    workerSpecs: JhLoopDefinitionDbRowSchema.fields.workerSpecs,
    source: JhLoopDefinitionDbRowSchema.fields.source,
    intervalSeconds: JhLoopDefinitionDbRowSchema.fields.intervalSeconds,
    activePollSeconds: JhLoopDefinitionDbRowSchema.fields.activePollSeconds,
    fastChainWindowMs: JhLoopDefinitionDbRowSchema.fields.fastChainWindowMs,
    fastChainMaxTransitions: JhLoopDefinitionDbRowSchema.fields.fastChainMaxTransitions,
    stopWhenWorkerDeleted: Schema.Number,
    createdAt: JhLoopDefinitionDbRowSchema.fields.createdAt,
    definitionUpdatedAt: JhLoopDefinitionDbRowSchema.fields.updatedAt,
    phase: JhLoopRuntimeStateDbRowSchema.fields.phase,
    completed: Schema.Number,
    lastRunAt: JhLoopRuntimeStateDbRowSchema.fields.lastRunAt,
    nextRunAt: JhLoopRuntimeStateDbRowSchema.fields.nextRunAt,
    lastHeartbeatAt: JhLoopRuntimeStateDbRowSchema.fields.lastHeartbeatAt,
    lastSummary: JhLoopRuntimeStateDbRowSchema.fields.lastSummary,
    lastError: JhLoopRuntimeStateDbRowSchema.fields.lastError,
    executionCount: JhLoopRuntimeStateDbRowSchema.fields.executionCount,
    workerThreadTitle: JhLoopRuntimeStateDbRowSchema.fields.workerThreadTitle,
    supervisorThreadTitle: JhLoopRuntimeStateDbRowSchema.fields.supervisorThreadTitle,
    workerThreadId: JhLoopRuntimeStateDbRowSchema.fields.workerThreadId,
    runtimeSupervisorThreadId: JhLoopRuntimeStateDbRowSchema.fields.supervisorThreadId,
    lastWorkerAssistantSummary: JhLoopRuntimeStateDbRowSchema.fields.lastWorkerAssistantSummary,
    lastSupervisorDecision: JhLoopRuntimeStateDbRowSchema.fields.lastSupervisorDecision,
    lastObservedTurnId: JhLoopRuntimeStateDbRowSchema.fields.lastObservedTurnId,
    lastConsumedSupervisorMessageId:
      JhLoopRuntimeStateDbRowSchema.fields.lastConsumedSupervisorMessageId,
    pendingWorkerPromptMessageId: JhLoopRuntimeStateDbRowSchema.fields.pendingWorkerPromptMessageId,
    lastForwardProgressAt: JhLoopRuntimeStateDbRowSchema.fields.lastForwardProgressAt,
    stoppedReason: JhLoopRuntimeStateDbRowSchema.fields.stoppedReason,
    activeWorkerKey: JhLoopRuntimeStateDbRowSchema.fields.activeWorkerKey,
    nextWorkerIndex: JhLoopRuntimeStateDbRowSchema.fields.nextWorkerIndex,
    workerRoster: JhLoopRuntimeStateDbRowSchema.fields.workerRoster,
    ignoredControlMessageKeys: JhLoopRuntimeStateDbRowSchema.fields.ignoredControlMessageKeys,
    ignoredControlMessageFingerprints:
      JhLoopRuntimeStateDbRowSchema.fields.ignoredControlMessageFingerprints,
    lastControlMessageKey: JhLoopRuntimeStateDbRowSchema.fields.lastControlMessageKey,
    lastHumanControlText: JhLoopRuntimeStateDbRowSchema.fields.lastHumanControlText,
    lastHumanControlAt: JhLoopRuntimeStateDbRowSchema.fields.lastHumanControlAt,
    lastHumanControlInstruction: JhLoopRuntimeStateDbRowSchema.fields.lastHumanControlInstruction,
    startupEnsured: Schema.Number,
    runtimeUpdatedAt: JhLoopRuntimeStateDbRowSchema.fields.updatedAt,
  });

  const getJoinedLoopByJobKey = SqlSchema.findOneOption({
    Request: GetJhLoopByJobKeyInput,
    Result: JoinedLoopQueryResultSchema,
    execute: ({ jobKey }) =>
      sql`
        SELECT
          d.loop_id AS "loopId",
          d.job_key AS "jobKey",
          d.loop_type AS "loopType",
          d.runtime_project_id AS "runtimeProjectId",
          d.workspace_root AS "workspaceRoot",
          d.project_title AS "projectTitle",
          d.objective,
          d.completion_criteria AS "completionCriteria",
          d.requested_state AS "requestedState",
          d.enabled,
          d.worker_model AS "workerModel",
          d.supervisor_model AS "supervisorModel",
          d.worker_runtime_mode AS "workerRuntimeMode",
          d.worker_interaction_mode AS "workerInteractionMode",
          d.supervisor_runtime_mode AS "supervisorRuntimeMode",
          d.supervisor_interaction_mode AS "supervisorInteractionMode",
          d.supervisor_thread_id AS "definitionSupervisorThreadId",
          d.worker_thread_ids_json AS "workerThreadIds",
          d.worker_specs_json AS "workerSpecs",
          d.source,
          d.interval_seconds AS "intervalSeconds",
          d.active_poll_seconds AS "activePollSeconds",
          d.fast_chain_window_ms AS "fastChainWindowMs",
          d.fast_chain_max_transitions AS "fastChainMaxTransitions",
          d.stop_when_worker_deleted AS "stopWhenWorkerDeleted",
          d.created_at AS "createdAt",
          d.updated_at AS "definitionUpdatedAt",
          r.phase,
          r.completed,
          r.last_run_at AS "lastRunAt",
          r.next_run_at AS "nextRunAt",
          r.last_heartbeat_at AS "lastHeartbeatAt",
          r.last_summary AS "lastSummary",
          r.last_error AS "lastError",
          r.execution_count AS "executionCount",
          r.worker_thread_title AS "workerThreadTitle",
          r.supervisor_thread_title AS "supervisorThreadTitle",
          r.worker_thread_id AS "workerThreadId",
          r.supervisor_thread_id AS "runtimeSupervisorThreadId",
          r.last_worker_assistant_summary AS "lastWorkerAssistantSummary",
          r.last_supervisor_decision AS "lastSupervisorDecision",
          r.last_observed_turn_id AS "lastObservedTurnId",
          r.last_consumed_supervisor_message_id AS "lastConsumedSupervisorMessageId",
          r.pending_worker_prompt_message_id AS "pendingWorkerPromptMessageId",
          r.last_forward_progress_at AS "lastForwardProgressAt",
          r.stopped_reason AS "stoppedReason",
          r.active_worker_key AS "activeWorkerKey",
          r.next_worker_index AS "nextWorkerIndex",
          r.worker_roster_json AS "workerRoster",
          r.ignored_control_message_keys_json AS "ignoredControlMessageKeys",
          r.ignored_control_message_fingerprints_json AS "ignoredControlMessageFingerprints",
          r.last_control_message_key AS "lastControlMessageKey",
          r.last_human_control_text AS "lastHumanControlText",
          r.last_human_control_at AS "lastHumanControlAt",
          r.last_human_control_instruction AS "lastHumanControlInstruction",
          r.startup_ensured AS "startupEnsured",
          r.updated_at AS "runtimeUpdatedAt"
        FROM jh_loop_definitions d
        INNER JOIN jh_loop_runtime_state r ON r.loop_id = d.loop_id
        WHERE d.job_key = ${jobKey}
      `,
  });

  const getJoinedLoopById = SqlSchema.findOneOption({
    Request: GetJhLoopByIdInput,
    Result: JoinedLoopQueryResultSchema,
    execute: ({ loopId }) =>
      sql`
        SELECT
          d.loop_id AS "loopId",
          d.job_key AS "jobKey",
          d.loop_type AS "loopType",
          d.runtime_project_id AS "runtimeProjectId",
          d.workspace_root AS "workspaceRoot",
          d.project_title AS "projectTitle",
          d.objective,
          d.completion_criteria AS "completionCriteria",
          d.requested_state AS "requestedState",
          d.enabled,
          d.worker_model AS "workerModel",
          d.supervisor_model AS "supervisorModel",
          d.worker_runtime_mode AS "workerRuntimeMode",
          d.worker_interaction_mode AS "workerInteractionMode",
          d.supervisor_runtime_mode AS "supervisorRuntimeMode",
          d.supervisor_interaction_mode AS "supervisorInteractionMode",
          d.supervisor_thread_id AS "definitionSupervisorThreadId",
          d.worker_thread_ids_json AS "workerThreadIds",
          d.worker_specs_json AS "workerSpecs",
          d.source,
          d.interval_seconds AS "intervalSeconds",
          d.active_poll_seconds AS "activePollSeconds",
          d.fast_chain_window_ms AS "fastChainWindowMs",
          d.fast_chain_max_transitions AS "fastChainMaxTransitions",
          d.stop_when_worker_deleted AS "stopWhenWorkerDeleted",
          d.created_at AS "createdAt",
          d.updated_at AS "definitionUpdatedAt",
          r.phase,
          r.completed,
          r.last_run_at AS "lastRunAt",
          r.next_run_at AS "nextRunAt",
          r.last_heartbeat_at AS "lastHeartbeatAt",
          r.last_summary AS "lastSummary",
          r.last_error AS "lastError",
          r.execution_count AS "executionCount",
          r.worker_thread_title AS "workerThreadTitle",
          r.supervisor_thread_title AS "supervisorThreadTitle",
          r.worker_thread_id AS "workerThreadId",
          r.supervisor_thread_id AS "runtimeSupervisorThreadId",
          r.last_worker_assistant_summary AS "lastWorkerAssistantSummary",
          r.last_supervisor_decision AS "lastSupervisorDecision",
          r.last_observed_turn_id AS "lastObservedTurnId",
          r.last_consumed_supervisor_message_id AS "lastConsumedSupervisorMessageId",
          r.pending_worker_prompt_message_id AS "pendingWorkerPromptMessageId",
          r.last_forward_progress_at AS "lastForwardProgressAt",
          r.stopped_reason AS "stoppedReason",
          r.active_worker_key AS "activeWorkerKey",
          r.next_worker_index AS "nextWorkerIndex",
          r.worker_roster_json AS "workerRoster",
          r.ignored_control_message_keys_json AS "ignoredControlMessageKeys",
          r.ignored_control_message_fingerprints_json AS "ignoredControlMessageFingerprints",
          r.last_control_message_key AS "lastControlMessageKey",
          r.last_human_control_text AS "lastHumanControlText",
          r.last_human_control_at AS "lastHumanControlAt",
          r.last_human_control_instruction AS "lastHumanControlInstruction",
          r.startup_ensured AS "startupEnsured",
          r.updated_at AS "runtimeUpdatedAt"
        FROM jh_loop_definitions d
        INNER JOIN jh_loop_runtime_state r ON r.loop_id = d.loop_id
        WHERE d.loop_id = ${loopId}
      `,
  });

  const listJoinedLoops = SqlSchema.findAll({
    Request: Schema.Void,
    Result: JoinedLoopQueryResultSchema,
    execute: () =>
      sql`
        SELECT
          d.loop_id AS "loopId",
          d.job_key AS "jobKey",
          d.loop_type AS "loopType",
          d.runtime_project_id AS "runtimeProjectId",
          d.workspace_root AS "workspaceRoot",
          d.project_title AS "projectTitle",
          d.objective,
          d.completion_criteria AS "completionCriteria",
          d.requested_state AS "requestedState",
          d.enabled,
          d.worker_model AS "workerModel",
          d.supervisor_model AS "supervisorModel",
          d.worker_runtime_mode AS "workerRuntimeMode",
          d.worker_interaction_mode AS "workerInteractionMode",
          d.supervisor_runtime_mode AS "supervisorRuntimeMode",
          d.supervisor_interaction_mode AS "supervisorInteractionMode",
          d.supervisor_thread_id AS "definitionSupervisorThreadId",
          d.worker_thread_ids_json AS "workerThreadIds",
          d.worker_specs_json AS "workerSpecs",
          d.source,
          d.interval_seconds AS "intervalSeconds",
          d.active_poll_seconds AS "activePollSeconds",
          d.fast_chain_window_ms AS "fastChainWindowMs",
          d.fast_chain_max_transitions AS "fastChainMaxTransitions",
          d.stop_when_worker_deleted AS "stopWhenWorkerDeleted",
          d.created_at AS "createdAt",
          d.updated_at AS "definitionUpdatedAt",
          r.phase,
          r.completed,
          r.last_run_at AS "lastRunAt",
          r.next_run_at AS "nextRunAt",
          r.last_heartbeat_at AS "lastHeartbeatAt",
          r.last_summary AS "lastSummary",
          r.last_error AS "lastError",
          r.execution_count AS "executionCount",
          r.worker_thread_title AS "workerThreadTitle",
          r.supervisor_thread_title AS "supervisorThreadTitle",
          r.worker_thread_id AS "workerThreadId",
          r.supervisor_thread_id AS "runtimeSupervisorThreadId",
          r.last_worker_assistant_summary AS "lastWorkerAssistantSummary",
          r.last_supervisor_decision AS "lastSupervisorDecision",
          r.last_observed_turn_id AS "lastObservedTurnId",
          r.last_consumed_supervisor_message_id AS "lastConsumedSupervisorMessageId",
          r.pending_worker_prompt_message_id AS "pendingWorkerPromptMessageId",
          r.last_forward_progress_at AS "lastForwardProgressAt",
          r.stopped_reason AS "stoppedReason",
          r.active_worker_key AS "activeWorkerKey",
          r.next_worker_index AS "nextWorkerIndex",
          r.worker_roster_json AS "workerRoster",
          r.ignored_control_message_keys_json AS "ignoredControlMessageKeys",
          r.ignored_control_message_fingerprints_json AS "ignoredControlMessageFingerprints",
          r.last_control_message_key AS "lastControlMessageKey",
          r.last_human_control_text AS "lastHumanControlText",
          r.last_human_control_at AS "lastHumanControlAt",
          r.last_human_control_instruction AS "lastHumanControlInstruction",
          r.startup_ensured AS "startupEnsured",
          r.updated_at AS "runtimeUpdatedAt"
        FROM jh_loop_definitions d
        INNER JOIN jh_loop_runtime_state r ON r.loop_id = d.loop_id
        ORDER BY d.created_at ASC, d.loop_id ASC
      `,
  });

  const countLoops = SqlSchema.findOne({
    Request: Schema.Void,
    Result: Schema.Struct({ count: Schema.Number }),
    execute: () => sql`SELECT COUNT(*) AS "count" FROM jh_loop_definitions`,
  });

  const deleteByLoopIdRow = SqlSchema.void({
    Request: GetJhLoopByIdInput,
    execute: ({ loopId }) => sql`DELETE FROM jh_loop_definitions WHERE loop_id = ${loopId}`,
  });

  const rowToRecord = (row: Schema.Schema.Type<typeof JoinedLoopQueryResultSchema>) => {
    try {
      return Effect.succeed(
        Schema.decodeUnknownSync(JhLoopRecord)({
          definition: {
            loopId: row.loopId,
            jobKey: row.jobKey,
            loopType: row.loopType,
            runtimeProjectId: row.runtimeProjectId,
            workspaceRoot: row.workspaceRoot,
            projectTitle: row.projectTitle,
            objective: row.objective,
            completionCriteria: row.completionCriteria,
            requestedState: row.requestedState,
            enabled: row.enabled === 1,
            workerModel: row.workerModel,
            supervisorModel: row.supervisorModel,
            workerRuntimeMode: row.workerRuntimeMode,
            workerInteractionMode: row.workerInteractionMode,
            supervisorRuntimeMode: row.supervisorRuntimeMode,
            supervisorInteractionMode: row.supervisorInteractionMode,
            supervisorThreadId: row.definitionSupervisorThreadId,
            workerThreadIds: row.workerThreadIds,
            workerSpecs: row.workerSpecs,
            source: row.source,
            intervalSeconds: row.intervalSeconds,
            activePollSeconds: row.activePollSeconds,
            fastChainWindowMs: row.fastChainWindowMs,
            fastChainMaxTransitions: row.fastChainMaxTransitions,
            stopWhenWorkerDeleted: row.stopWhenWorkerDeleted === 1,
            createdAt: row.createdAt,
            updatedAt: row.definitionUpdatedAt,
          },
          runtimeState: {
            loopId: row.loopId,
            phase: row.phase,
            completed: row.completed === 1,
            lastRunAt: row.lastRunAt,
            nextRunAt: row.nextRunAt,
            lastHeartbeatAt: row.lastHeartbeatAt,
            lastSummary: row.lastSummary,
            lastError: row.lastError,
            executionCount: row.executionCount,
            workerThreadTitle: row.workerThreadTitle,
            supervisorThreadTitle: row.supervisorThreadTitle,
            workerThreadId: row.workerThreadId,
            supervisorThreadId: row.runtimeSupervisorThreadId,
            lastWorkerAssistantSummary: row.lastWorkerAssistantSummary,
            lastSupervisorDecision: row.lastSupervisorDecision,
            lastObservedTurnId: row.lastObservedTurnId,
            lastConsumedSupervisorMessageId: row.lastConsumedSupervisorMessageId,
            pendingWorkerPromptMessageId: row.pendingWorkerPromptMessageId,
            lastForwardProgressAt: row.lastForwardProgressAt,
            stoppedReason: row.stoppedReason,
            activeWorkerKey: row.activeWorkerKey,
            nextWorkerIndex: row.nextWorkerIndex,
            workerRoster: row.workerRoster,
            ignoredControlMessageKeys: row.ignoredControlMessageKeys,
            ignoredControlMessageFingerprints: row.ignoredControlMessageFingerprints,
            lastControlMessageKey: row.lastControlMessageKey,
            lastHumanControlText: row.lastHumanControlText,
            lastHumanControlAt: row.lastHumanControlAt,
            lastHumanControlInstruction: row.lastHumanControlInstruction,
            startupEnsured: row.startupEnsured === 1,
            updatedAt: row.runtimeUpdatedAt,
          },
        }),
      );
    } catch (error) {
      if (Schema.isSchemaError(error)) {
        return Effect.fail(toPersistenceDecodeError("JhLoopRuntimeRepository.rowToRecord")(error));
      }
      return Effect.fail(toPersistenceSqlError("JhLoopRuntimeRepository.rowToRecord")(error));
    }
  };

  const upsertDefinition: JhLoopRuntimeRepositoryShape["upsertDefinition"] = (definition) =>
    sql`
      INSERT INTO jh_loop_definitions (
        loop_id,
        job_key,
        loop_type,
        runtime_project_id,
        workspace_root,
        project_title,
        objective,
        completion_criteria,
        requested_state,
        enabled,
        worker_model,
        supervisor_model,
        worker_runtime_mode,
        worker_interaction_mode,
        supervisor_runtime_mode,
        supervisor_interaction_mode,
        supervisor_thread_id,
        worker_thread_ids_json,
        worker_specs_json,
        source,
        interval_seconds,
        active_poll_seconds,
        fast_chain_window_ms,
        fast_chain_max_transitions,
        stop_when_worker_deleted,
        created_at,
        updated_at
      )
      VALUES (
        ${definition.loopId},
        ${definition.jobKey},
        ${definition.loopType},
        ${definition.runtimeProjectId},
        ${definition.workspaceRoot},
        ${definition.projectTitle},
        ${definition.objective},
        ${definition.completionCriteria},
        ${definition.requestedState},
        ${definition.enabled ? 1 : 0},
        ${definition.workerModel},
        ${definition.supervisorModel},
        ${definition.workerRuntimeMode},
        ${definition.workerInteractionMode},
        ${definition.supervisorRuntimeMode},
        ${definition.supervisorInteractionMode},
        ${definition.supervisorThreadId},
        ${JSON.stringify(definition.workerThreadIds)},
        ${JSON.stringify(definition.workerSpecs)},
        ${definition.source},
        ${definition.intervalSeconds},
        ${definition.activePollSeconds},
        ${definition.fastChainWindowMs},
        ${definition.fastChainMaxTransitions},
        ${definition.stopWhenWorkerDeleted ? 1 : 0},
        ${definition.createdAt},
        ${definition.updatedAt}
      )
      ON CONFLICT (loop_id)
      DO UPDATE SET
        job_key = excluded.job_key,
        loop_type = excluded.loop_type,
        runtime_project_id = excluded.runtime_project_id,
        workspace_root = excluded.workspace_root,
        project_title = excluded.project_title,
        objective = excluded.objective,
        completion_criteria = excluded.completion_criteria,
        requested_state = excluded.requested_state,
        enabled = excluded.enabled,
        worker_model = excluded.worker_model,
        supervisor_model = excluded.supervisor_model,
        worker_runtime_mode = excluded.worker_runtime_mode,
        worker_interaction_mode = excluded.worker_interaction_mode,
        supervisor_runtime_mode = excluded.supervisor_runtime_mode,
        supervisor_interaction_mode = excluded.supervisor_interaction_mode,
        supervisor_thread_id = excluded.supervisor_thread_id,
        worker_thread_ids_json = excluded.worker_thread_ids_json,
        worker_specs_json = excluded.worker_specs_json,
        source = excluded.source,
        interval_seconds = excluded.interval_seconds,
        active_poll_seconds = excluded.active_poll_seconds,
        fast_chain_window_ms = excluded.fast_chain_window_ms,
        fast_chain_max_transitions = excluded.fast_chain_max_transitions,
        stop_when_worker_deleted = excluded.stop_when_worker_deleted,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `.pipe(Effect.mapError(toPersistenceSqlError("JhLoopRuntimeRepository.upsertDefinition:query")));

  const upsertRuntimeState: JhLoopRuntimeRepositoryShape["upsertRuntimeState"] = (runtimeState) =>
    sql`
      INSERT INTO jh_loop_runtime_state (
        loop_id,
        phase,
        completed,
        last_run_at,
        next_run_at,
        last_heartbeat_at,
        last_summary,
        last_error,
        execution_count,
        worker_thread_title,
        supervisor_thread_title,
        worker_thread_id,
        supervisor_thread_id,
        last_worker_assistant_summary,
        last_supervisor_decision,
        last_observed_turn_id,
        last_consumed_supervisor_message_id,
        pending_worker_prompt_message_id,
        last_forward_progress_at,
        stopped_reason,
        active_worker_key,
        next_worker_index,
        worker_roster_json,
        ignored_control_message_keys_json,
        ignored_control_message_fingerprints_json,
        last_control_message_key,
        last_human_control_text,
        last_human_control_at,
        last_human_control_instruction,
        startup_ensured,
        updated_at
      )
      VALUES (
        ${runtimeState.loopId},
        ${runtimeState.phase},
        ${runtimeState.completed ? 1 : 0},
        ${runtimeState.lastRunAt},
        ${runtimeState.nextRunAt},
        ${runtimeState.lastHeartbeatAt},
        ${runtimeState.lastSummary},
        ${runtimeState.lastError},
        ${runtimeState.executionCount},
        ${runtimeState.workerThreadTitle},
        ${runtimeState.supervisorThreadTitle},
        ${runtimeState.workerThreadId},
        ${runtimeState.supervisorThreadId},
        ${runtimeState.lastWorkerAssistantSummary},
        ${runtimeState.lastSupervisorDecision},
        ${runtimeState.lastObservedTurnId},
        ${runtimeState.lastConsumedSupervisorMessageId},
        ${runtimeState.pendingWorkerPromptMessageId},
        ${runtimeState.lastForwardProgressAt},
        ${runtimeState.stoppedReason},
        ${runtimeState.activeWorkerKey},
        ${runtimeState.nextWorkerIndex},
        ${JSON.stringify(runtimeState.workerRoster)},
        ${JSON.stringify(runtimeState.ignoredControlMessageKeys)},
        ${JSON.stringify(runtimeState.ignoredControlMessageFingerprints)},
        ${runtimeState.lastControlMessageKey},
        ${runtimeState.lastHumanControlText},
        ${runtimeState.lastHumanControlAt},
        ${runtimeState.lastHumanControlInstruction},
        ${runtimeState.startupEnsured ? 1 : 0},
        ${runtimeState.updatedAt}
      )
      ON CONFLICT (loop_id)
      DO UPDATE SET
        phase = excluded.phase,
        completed = excluded.completed,
        last_run_at = excluded.last_run_at,
        next_run_at = excluded.next_run_at,
        last_heartbeat_at = excluded.last_heartbeat_at,
        last_summary = excluded.last_summary,
        last_error = excluded.last_error,
        execution_count = excluded.execution_count,
        worker_thread_title = excluded.worker_thread_title,
        supervisor_thread_title = excluded.supervisor_thread_title,
        worker_thread_id = excluded.worker_thread_id,
        supervisor_thread_id = excluded.supervisor_thread_id,
        last_worker_assistant_summary = excluded.last_worker_assistant_summary,
        last_supervisor_decision = excluded.last_supervisor_decision,
        last_observed_turn_id = excluded.last_observed_turn_id,
        last_consumed_supervisor_message_id = excluded.last_consumed_supervisor_message_id,
        pending_worker_prompt_message_id = excluded.pending_worker_prompt_message_id,
        last_forward_progress_at = excluded.last_forward_progress_at,
        stopped_reason = excluded.stopped_reason,
        active_worker_key = excluded.active_worker_key,
        next_worker_index = excluded.next_worker_index,
        worker_roster_json = excluded.worker_roster_json,
        ignored_control_message_keys_json = excluded.ignored_control_message_keys_json,
        ignored_control_message_fingerprints_json = excluded.ignored_control_message_fingerprints_json,
        last_control_message_key = excluded.last_control_message_key,
        last_human_control_text = excluded.last_human_control_text,
        last_human_control_at = excluded.last_human_control_at,
        last_human_control_instruction = excluded.last_human_control_instruction,
        startup_ensured = excluded.startup_ensured,
        updated_at = excluded.updated_at
    `.pipe(Effect.mapError(toPersistenceSqlError("JhLoopRuntimeRepository.upsertRuntimeState:query")));

  const getByJobKey: JhLoopRuntimeRepositoryShape["getByJobKey"] = (input) =>
    (Effect.gen(function* () {
      const rowOption = yield* getJoinedLoopByJobKey(input).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "JhLoopRuntimeRepository.getByJobKey:query",
            "JhLoopRuntimeRepository.getByJobKey:decodeRow",
          ),
        ),
      );
      if (Option.isNone(rowOption)) {
        return Option.none();
      }
      const record = yield* rowToRecord(rowOption.value);
      return Option.some(record);
    }) as any);

  const getByLoopId: JhLoopRuntimeRepositoryShape["getByLoopId"] = (input) =>
    (Effect.gen(function* () {
      const rowOption = yield* getJoinedLoopById(input).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "JhLoopRuntimeRepository.getByLoopId:query",
            "JhLoopRuntimeRepository.getByLoopId:decodeRow",
          ),
        ),
      );
      if (Option.isNone(rowOption)) {
        return Option.none();
      }
      const record = yield* rowToRecord(rowOption.value);
      return Option.some(record);
    }) as any);

  const listAll: JhLoopRuntimeRepositoryShape["listAll"] = () =>
    (listJoinedLoops(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "JhLoopRuntimeRepository.listAll:query",
          "JhLoopRuntimeRepository.listAll:decodeRows",
        ),
      ),
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) => rowToRecord(row) as any, {
          concurrency: "unbounded",
        }),
      ),
    ) as any);

  const count: JhLoopRuntimeRepositoryShape["count"] = () =>
    countLoops(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("JhLoopRuntimeRepository.count:query")),
      Effect.map((row) => row.count),
    );

  const deleteByLoopId: JhLoopRuntimeRepositoryShape["deleteByLoopId"] = (input) =>
    deleteByLoopIdRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("JhLoopRuntimeRepository.deleteByLoopId:query")),
    );

  return {
    upsertDefinition,
    upsertRuntimeState,
    getByJobKey,
    getByLoopId,
    listAll,
    count,
    deleteByLoopId,
  } satisfies JhLoopRuntimeRepositoryShape;
});

export const JhLoopRuntimeRepositoryLive = Layer.effect(
  JhLoopRuntimeRepository,
  makeJhLoopRuntimeRepository,
);
