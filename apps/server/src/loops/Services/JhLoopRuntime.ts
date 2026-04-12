import type {
  JhLoopControlRequest,
  JhLoopControlResult,
  JhLoopCreateRequest,
  JhLoopCreateResult,
  JhLoopStatusResult,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Option } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface JhLoopRuntimeServiceShape {
  readonly start: Effect.Effect<void, never, any>;
  readonly createLoop: (
    request: JhLoopCreateRequest,
  ) => Effect.Effect<JhLoopCreateResult, ProjectionRepositoryError | Error>;
  readonly controlLoop: (
    request: JhLoopControlRequest,
  ) => Effect.Effect<Option.Option<JhLoopControlResult>, ProjectionRepositoryError | Error>;
  readonly getLoopStatus: (
    jobKey: string,
  ) => Effect.Effect<Option.Option<JhLoopStatusResult>, ProjectionRepositoryError | Error>;
}

export class JhLoopRuntimeService extends ServiceMap.Service<
  JhLoopRuntimeService,
  JhLoopRuntimeServiceShape
>()("t3/loops/Services/JhLoopRuntime/JhLoopRuntimeService") {}
