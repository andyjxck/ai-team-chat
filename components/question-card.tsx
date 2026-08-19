"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Check, HelpCircle, CornerDownLeft, Pencil } from "lucide-react";
import type { QuestionData } from "@/db/client-types";

export function QuestionCard({
  question,
  onSelect,
}: {
  question: QuestionData;
  onSelect: (answer: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(
    question.answered ? question.selected ?? null : null,
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [phase, setPhase] = useState<"asking" | "answered">(
    question.answered ? "answered" : "asking",
  );
  const otherInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showOther) {
      otherInputRef.current?.focus();
    }
  }, [showOther]);

  function handleSelect(label: string) {
    if (selected) return;
    setSelected(label);
    setPhase("answered");
    onSelect(label);
  }

  function handleOtherSubmit() {
    const text = otherText.trim();
    if (!text) return;
    handleSelect(text);
  }

  function handleOtherKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleOtherSubmit();
    }
  }

  return (
    <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/[0.07] to-indigo-500/[0.05] overflow-hidden animate-scale-in shadow-lg">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-blue-500/15 bg-blue-500/[0.03]">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/15">
          <HelpCircle className="h-4 w-4 text-blue-500" />
        </div>
        <div className="flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-500/70">Agent Question</p>
          <p className="text-sm font-semibold text-foreground mt-0.5">{question.question}</p>
        </div>
      </div>

      {/* Options */}
      {phase === "asking" && (
        <div className="p-3 space-y-1.5">
          {question.options.map((option, i) => {
            const isSelected = selected === option.label;
            const isHovered = hovered === i;

            return (
              <button
                key={i}
                onClick={() => handleSelect(option.label)}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                disabled={!!selected}
                className={cn(
                  "group w-full text-left rounded-xl border px-4 py-3 transition-all",
                  isSelected
                    ? "border-blue-500 bg-blue-500/10"
                    : isHovered
                      ? "border-blue-500/40 bg-blue-500/5"
                      : "border-border/50 bg-card hover:border-blue-500/30",
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                      isSelected
                        ? "border-blue-500 bg-blue-500"
                        : "border-muted-foreground/30 group-hover:border-blue-500/50",
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{option.label}</p>
                    {option.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{option.description}</p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {/* Other option */}
          {!showOther ? (
            <button
              onClick={() => setShowOther(true)}
              disabled={!!selected}
              className={cn(
                "group w-full text-left rounded-xl border border-dashed px-4 py-3 transition-all",
                "border-border/50 bg-card hover:border-blue-500/30 hover:bg-blue-500/5",
              )}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/30 group-hover:border-blue-500/50 transition-all">
                  <Pencil className="h-2.5 w-2.5 text-muted-foreground/50 group-hover:text-blue-500/50" />
                </div>
                <p className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                  Other
                </p>
              </div>
            </button>
          ) : (
            <div className="rounded-xl border border-blue-500/40 bg-card px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-blue-500 bg-blue-500">
                  <Pencil className="h-2.5 w-2.5 text-white" />
                </div>
                <input
                  ref={otherInputRef}
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  onKeyDown={handleOtherKeyDown}
                  placeholder="Type your answer..."
                  className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
                />
                <button
                  onClick={handleOtherSubmit}
                  disabled={!otherText.trim()}
                  className="flex items-center gap-1 rounded-lg bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition-all hover:bg-blue-600 disabled:opacity-30"
                >
                  <CornerDownLeft className="h-3 w-3" />
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Answered state */}
      {phase === "answered" && selected && (
        <div className="px-5 py-4">
          <div className="flex items-center gap-3 rounded-xl bg-blue-500/10 border border-blue-500/20 px-4 py-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500">
              <Check className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-500/60">Your answer</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{selected}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
