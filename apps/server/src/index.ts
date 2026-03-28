import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CliConfig, t3Cli } from "./main";
import { OpenLive } from "./open";
import { Command } from "effect/unstable/cli";
import { version } from "../package.json" with { type: "json" };
import { ServerLive } from "./wsServer";
import { NetService } from "@t3tools/shared/Net";
import { FetchHttpClient } from "effect/unstable/http";
import { createLogger } from "./logger";

const RuntimeLayer = Layer.empty.pipe(
  Layer.provideMerge(CliConfig.layer),
  Layer.provideMerge(ServerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

const lifecycleLogger = createLogger("lifecycle");

process.on("warning", (warning) => {
  lifecycleLogger.warn("process warning", {
    name: warning.name,
    message: warning.message,
    stack: warning.stack,
  });
});

process.on("unhandledRejection", (reason, promise) => {
  lifecycleLogger.error("unhandled rejection", {
    reason,
    promise,
  });
});

process.on("uncaughtExceptionMonitor", (error, origin) => {
  lifecycleLogger.error("uncaught exception", {
    origin,
    message: error.message,
    stack: error.stack,
  });
});

process.on("beforeExit", (code) => {
  lifecycleLogger.warn("process beforeExit", {
    code,
    pid: process.pid,
  });
});

process.on("exit", (code) => {
  lifecycleLogger.warn("process exit", {
    code,
    pid: process.pid,
  });
});

Command.run(t3Cli, { version }).pipe(Effect.provide(RuntimeLayer), NodeRuntime.runMain);
