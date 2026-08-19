"use client";

import { useUpload } from "./upload-provider";
import { Upload, Check, Loader2, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function UploadPill() {
  const { upload } = useUpload();

  if (!upload) return null;

  const pct = upload.total > 0 ? Math.round((upload.current / upload.total) * 100) : 0;
  const hasError = upload.error;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
      <div className={cn(
        "flex items-center gap-3 rounded-2xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur transition-all max-w-md",
        hasError ? "border-red-500/40" : upload.active ? "border-blue-500/40" : "border-green-500/40",
      )}>
        {upload.active ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
        ) : hasError ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
        ) : (
          <Check className="h-4 w-4 shrink-0 text-green-500" />
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">{upload.repo}</span>
            {upload.total > 0 && (
              <>
                <span className="text-xs text-muted-foreground">{upload.current}/{upload.total}</span>
                <span className="text-xs font-semibold">{pct}%</span>
              </>
            )}
          </div>
          <span className={cn("text-xs", hasError ? "text-red-500" : "text-muted-foreground")}>
            {upload.status}
          </span>
          {upload.total > 0 && (
            <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  hasError ? "bg-red-500" : upload.active ? "bg-blue-500" : "bg-green-500",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
