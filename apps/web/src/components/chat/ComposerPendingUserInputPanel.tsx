import { type ApprovalRequestId } from "@t3tools/contracts";
import { memo, useCallback, useEffect, useRef } from "react";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, PencilLineIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

function classifyOptionAffordance(optionLabel: string): {
  label: string;
  className: string;
} | null {
  const normalized = optionLabel.toLowerCase();
  if (normalized.includes("recommended")) {
    return {
      label: "Recommended",
      className: "border-emerald-500/20 bg-emerald-500/8 text-emerald-300",
    };
  }
  if (
    normalized.includes("skip") ||
    normalized.includes("decline") ||
    normalized.includes("never mind") ||
    normalized.includes("don't send") ||
    normalized.includes("do nothing")
  ) {
    return {
      label: "No action",
      className: "border-amber-500/20 bg-amber-500/8 text-amber-300",
    };
  }
  if (
    normalized.includes("draft") ||
    normalized.includes("reply") ||
    normalized.includes("apply")
  ) {
    return {
      label: "Action",
      className: "border-sky-500/20 bg-sky-500/8 text-sky-300",
    };
  }
  return null;
}

function isFillInOptionLabel(optionLabel: string): boolean {
  return /(other|custom|constrained)/i.test(optionLabel);
}

function stripAffordanceSuffix(optionLabel: string): string {
  return optionLabel.replace(/\s*\((recommended)\)\s*$/i, "").trim();
}

function normalizeOptionDescription(option: { label: string; description: string }): string {
  if (isFillInOptionLabel(option.label)) {
    return "Type your custom details in the composer below, then continue.";
  }
  return option.description;
}

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  enhancedExperienceEnabled: boolean;
  onSelectOption: (questionId: string, optionLabel: string) => void;
  onPrevious: () => void;
  onAdvance: () => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  enhancedExperienceEnabled,
  onSelectOption,
  onPrevious,
  onAdvance,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      enhancedExperienceEnabled={enhancedExperienceEnabled}
      onSelectOption={onSelectOption}
      onPrevious={onPrevious}
      onAdvance={onAdvance}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  enhancedExperienceEnabled,
  onSelectOption,
  onPrevious,
  onAdvance,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  enhancedExperienceEnabled: boolean;
  onSelectOption: (questionId: string, optionLabel: string) => void;
  onPrevious: () => void;
  onAdvance: () => void;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const hasMultipleQuestions = enhancedExperienceEnabled && prompt.questions.length > 1;
  const orderedOptions = activeQuestion
    ? [...activeQuestion.options].sort((left, right) => {
        if (!enhancedExperienceEnabled) {
          return 0;
        }
        const leftIsFillIn = isFillInOptionLabel(left.label);
        const rightIsFillIn = isFillInOptionLabel(right.label);
        if (leftIsFillIn === rightIsFillIn) {
          return 0;
        }
        return leftIsFillIn ? 1 : -1;
      })
    : [];

  // Clear auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  const selectOptionAndAutoAdvance = useCallback(
    (questionId: string, optionLabel: string) => {
      onSelectOption(questionId, optionLabel);
      if (!enhancedExperienceEnabled || isFillInOptionLabel(optionLabel)) {
        return;
      }
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null;
        onAdvance();
      }, 200);
    },
    [enhancedExperienceEnabled, onSelectOption, onAdvance],
  );

  // Keyboard shortcut: number keys 1-9 select corresponding option and auto-advance.
  // Works even when the Lexical composer (contenteditable) has focus — the composer
  // doubles as a custom-answer field during user input, and when it's empty the digit
  // keys should pick options instead of typing into the editor.
  useEffect(() => {
    if (!activeQuestion || isResponding) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      // If the user has started typing a custom answer in the contenteditable
      // composer, let digit keys pass through so they can type numbers.
      if (target instanceof HTMLElement && target.isContentEditable) {
        const hasCustomText = progress.customAnswer.length > 0;
        if (hasCustomText) return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const optionIndex = digit - 1;
      if (optionIndex >= orderedOptions.length) return;
      const option = orderedOptions[optionIndex];
      if (!option) return;
      event.preventDefault();
      selectOptionAndAutoAdvance(activeQuestion.id, option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, isResponding, orderedOptions, selectOptionAndAutoAdvance, progress.customAnswer.length]);

  if (!activeQuestion) {
    return null;
  }

  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {hasMultipleQuestions ? (
            <span className="flex h-5 items-center rounded-md bg-muted/60 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/60">
              {questionIndex + 1}/{prompt.questions.length}
            </span>
          ) : null}
          <span className="text-[11px] font-semibold tracking-widest text-muted-foreground/50 uppercase">
            {activeQuestion.header}
          </span>
        </div>
        {hasMultipleQuestions ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 cursor-pointer rounded-md text-muted-foreground/70"
              onClick={onPrevious}
              disabled={isResponding || questionIndex === 0}
              aria-label="Previous question"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 cursor-pointer rounded-md text-muted-foreground/70"
              onClick={onAdvance}
              disabled={isResponding || !progress.canAdvance || progress.isLastQuestion}
              aria-label="Next question"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm text-foreground/90">{activeQuestion.question}</p>
      <div className="mt-3 space-y-1">
        {orderedOptions.map((option, index) => {
          const isSelected = progress.selectedOptionLabel === option.label;
          const shortcutKey = index < 9 ? index + 1 : null;
          const isFillInOption = isFillInOptionLabel(option.label);
          const affordance = classifyOptionAffordance(option.label);
          const normalizedDescription = normalizeOptionDescription(option);
          return (
            <button
              key={`${activeQuestion.id}:${option.label}`}
              type="button"
              disabled={isResponding}
              onClick={() => selectOptionAndAutoAdvance(activeQuestion.id, option.label)}
              className={cn(
                "group flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-150",
                isSelected
                  ? "border-blue-500/40 bg-blue-500/8 text-foreground"
                  : "border-transparent bg-muted/20 text-foreground/80 hover:bg-muted/40 hover:border-border/40",
                isResponding && "opacity-50 cursor-not-allowed",
              )}
            >
              {shortcutKey !== null ? (
                <kbd
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-medium tabular-nums transition-colors duration-150",
                    isSelected
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-muted/40 text-muted-foreground/50 group-hover:bg-muted/60 group-hover:text-muted-foreground/70",
                  )}
                >
                  {shortcutKey}
                </kbd>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {enhancedExperienceEnabled && affordance
                      ? stripAffordanceSuffix(option.label)
                      : option.label}
                  </span>
                  {enhancedExperienceEnabled && affordance ? (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]",
                        affordance.className,
                      )}
                    >
                      {affordance.label}
                    </span>
                  ) : null}
                  {enhancedExperienceEnabled && isFillInOption ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                      <PencilLineIcon className="size-3" />
                      Fill in below
                    </span>
                  ) : null}
                </div>
                {normalizedDescription && normalizedDescription !== option.label ? (
                  <div className="mt-0.5 text-xs text-muted-foreground/50">
                    {enhancedExperienceEnabled ? normalizedDescription : option.description}
                  </div>
                ) : null}
              </div>
              {isSelected ? <CheckIcon className="size-3.5 shrink-0 text-blue-400" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
});
