import http from "node:http";

import {
  JhLoopControlRequest as JhLoopControlRequestSchema,
  JhLoopCreateRequest as JhLoopCreateRequestSchema,
} from "@t3tools/contracts";
import { Effect, Option, Schema } from "effect";

import type { JhLoopRuntimeServiceShape } from "./loops/Services/JhLoopRuntime.ts";

export const JH_LOOPS_ROUTE_PATH = "/jh/loops";

type Respond = (statusCode: number, headers?: Record<string, string>, body?: string) => void;

type JhLoopRouteInput = {
  req: http.IncomingMessage;
  url: URL;
  readRequestBody: () => Effect.Effect<string, unknown>;
  respond: Respond;
  jhLoopRuntime: JhLoopRuntimeServiceShape;
};

function decodeJhLoopCreateRequest(raw: string) {
  try {
    return Schema.decodeUnknownSync(JhLoopCreateRequestSchema)(JSON.parse(raw));
  } catch {
    return null;
  }
}

function decodeJhLoopControlRequest(raw: string) {
  try {
    return Schema.decodeUnknownSync(JhLoopControlRequestSchema)(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function tryHandleJhLoopRoute(input: JhLoopRouteInput) {
  return Effect.gen(function* () {
    if (input.url.pathname !== JH_LOOPS_ROUTE_PATH) {
      return false;
    }

    const commonHeaders = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    };

    if (input.req.method === "OPTIONS") {
      input.respond(204, {
        ...commonHeaders,
        "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return true;
    }

    if (input.req.method === "GET") {
      const jobKey = input.url.searchParams.get("job_key")?.trim() ?? "";
      if (jobKey.length === 0) {
        input.respond(
          400,
          commonHeaders,
          JSON.stringify({ error: "Missing required job_key query parameter." }),
        );
        return true;
      }

      const status = yield* input.jhLoopRuntime.getLoopStatus(jobKey);
      if (Option.isNone(status)) {
        input.respond(404, commonHeaders, JSON.stringify({ error: "Loop not found." }));
        return true;
      }

      input.respond(200, commonHeaders, JSON.stringify(Option.getOrThrow(status)));
      return true;
    }

    if (input.req.method === "POST") {
      const requestBodyText = yield* input.readRequestBody();
      const parsedRequestBody = decodeJhLoopCreateRequest(requestBodyText);
      if (!parsedRequestBody) {
        input.respond(400, commonHeaders, JSON.stringify({ error: "Invalid loop create body." }));
        return true;
      }

      const result = yield* input.jhLoopRuntime.createLoop(parsedRequestBody);
      input.respond(200, commonHeaders, JSON.stringify(result));
      return true;
    }

    if (input.req.method === "PATCH") {
      const requestBodyText = yield* input.readRequestBody();
      const parsedRequestBody = decodeJhLoopControlRequest(requestBodyText);
      if (!parsedRequestBody) {
        input.respond(400, commonHeaders, JSON.stringify({ error: "Invalid loop control body." }));
        return true;
      }

      const result = yield* input.jhLoopRuntime.controlLoop(parsedRequestBody);
      if (Option.isNone(result)) {
        input.respond(404, commonHeaders, JSON.stringify({ error: "Loop not found." }));
        return true;
      }

      input.respond(200, commonHeaders, JSON.stringify(Option.getOrThrow(result)));
      return true;
    }

    input.respond(405, commonHeaders, JSON.stringify({ error: "Method not allowed." }));
    return true;
  });
}
