import { createHash } from "node:crypto";
import {
  type JhComposerDraftStateEntry,
  JhComposerDraftStateEntry as JhComposerDraftStateEntrySchema,
  type JhComposerDraftStateResult,
  type JhComposerPrefillRequest,
  type JhComposerPrefillMode,
  NonNegativeInt,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, type FileSystem, type Path, Schema } from "effect";

const JH_COMPOSER_PREFILL_STATE_FILE = "jh-composer-prefills.json";

const PersistedJhComposerPrefillState = Schema.Struct({
  revisionsByThreadId: Schema.Record(ThreadId, NonNegativeInt),
  entriesByThreadId: Schema.Record(ThreadId, JhComposerDraftStateEntrySchema),
});
type PersistedJhComposerPrefillState = typeof PersistedJhComposerPrefillState.Type;

const EMPTY_JH_COMPOSER_PREFILL_STATE: PersistedJhComposerPrefillState = {
  revisionsByThreadId: {},
  entriesByThreadId: {},
};

function decodePersistedJhComposerPrefillState(raw: string): PersistedJhComposerPrefillState {
  try {
    return Schema.decodeUnknownSync(PersistedJhComposerPrefillState)(JSON.parse(raw));
  } catch {
    return EMPTY_JH_COMPOSER_PREFILL_STATE;
  }
}

function prefillStatePath(input: { stateDir: string; path: Path.Path }): string {
  return input.path.join(input.stateDir, JH_COMPOSER_PREFILL_STATE_FILE);
}

function resolveNextText(input: {
  currentText: string;
  incomingText: string;
  mode: JhComposerPrefillMode;
}): string {
  if (input.mode === "append") {
    return `${input.currentText}${input.incomingText}`;
  }
  return input.incomingText;
}

function createDraftId(input: {
  threadId: string;
  revision: number;
  text: string;
  updatedAt: string;
}): string {
  return createHash("sha256")
    .update(`${input.threadId}\u0000${input.revision}\u0000${input.updatedAt}\u0000${input.text}`)
    .digest("hex");
}

interface JhComposerPrefillStoreDeps {
  stateDir: string;
  fileSystem: FileSystem.FileSystem;
  path: Path.Path;
}

const loadPersistedJhComposerPrefillState = Effect.fn(function* (
  deps: JhComposerPrefillStoreDeps,
) {
  const filePath = prefillStatePath({ stateDir: deps.stateDir, path: deps.path });
  const raw = yield* deps.fileSystem.readFileString(filePath).pipe(
    Effect.catch(() => Effect.succeed(null)),
  );
  if (!raw) {
    return EMPTY_JH_COMPOSER_PREFILL_STATE;
  }
  return decodePersistedJhComposerPrefillState(raw);
});

const persistJhComposerPrefillState = Effect.fn(function* (
  input: JhComposerPrefillStoreDeps & { state: PersistedJhComposerPrefillState },
) {
  const filePath = prefillStatePath({ stateDir: input.stateDir, path: input.path });
  yield* input.fileSystem.makeDirectory(input.path.dirname(filePath), { recursive: true });
  yield* input.fileSystem.writeFileString(filePath, JSON.stringify(input.state, null, 2));
});

export const readJhComposerDraftState = Effect.fn(function* (
  input: JhComposerPrefillStoreDeps & { threadId: ThreadId },
) {
  const state = yield* loadPersistedJhComposerPrefillState(input);
  return {
    threadId: input.threadId,
    revision: state.revisionsByThreadId[input.threadId] ?? 0,
    entry: state.entriesByThreadId[input.threadId] ?? null,
  };
});

export const upsertJhComposerDraftState = Effect.fn(function* (
  input: JhComposerPrefillStoreDeps & { prefill: JhComposerPrefillRequest },
) {
  const state = yield* loadPersistedJhComposerPrefillState(input);
  const mode = input.prefill.mode ?? "replace";
  const currentEntry = state.entriesByThreadId[input.prefill.threadId];
  const revision = (state.revisionsByThreadId[input.prefill.threadId] ?? 0) + 1;
  const updatedAt = new Date().toISOString();
  const text = resolveNextText({
    currentText: currentEntry?.text ?? "",
    incomingText: input.prefill.text,
    mode,
  });
  const entry: JhComposerDraftStateEntry = {
    projectId: input.prefill.projectId,
    threadId: input.prefill.threadId,
    draftId: createDraftId({
      threadId: input.prefill.threadId,
      revision,
      text,
      updatedAt,
    }),
    text,
    mode,
    revision,
    updatedAt,
    ...(input.prefill.metadata ? { metadata: input.prefill.metadata } : {}),
  };
  yield* persistJhComposerPrefillState({
    ...input,
    state: {
      revisionsByThreadId: {
        ...state.revisionsByThreadId,
        [input.prefill.threadId]: revision,
      },
      entriesByThreadId: {
        ...state.entriesByThreadId,
        [input.prefill.threadId]: entry,
      },
    },
  });
  return entry;
});

export const clearJhComposerDraftState = Effect.fn(function* (
  input: JhComposerPrefillStoreDeps & { threadId: ThreadId },
) {
  const state = yield* loadPersistedJhComposerPrefillState(input);
  const revision = (state.revisionsByThreadId[input.threadId] ?? 0) + 1;
  const { [input.threadId]: _discardedEntry, ...remainingEntries } = state.entriesByThreadId;
  yield* persistJhComposerPrefillState({
    ...input,
    state: {
      revisionsByThreadId: {
        ...state.revisionsByThreadId,
        [input.threadId]: revision,
      },
      entriesByThreadId: remainingEntries,
    },
  });
  return {
    revision,
    updatedAt: new Date().toISOString(),
  };
});
