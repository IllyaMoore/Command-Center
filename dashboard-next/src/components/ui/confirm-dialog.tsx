"use client";

import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  const isDanger = variant === "danger";

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="bg-surface-1 border border-surface-border shadow-xl w-80 animate-slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header stripe */}
        <div className={`h-1 ${isDanger ? "bg-signal-error" : "bg-primary"}`} />

        <div className="px-5 pt-4 pb-5">
          <h3 className="font-mono text-xs font-semibold text-text-primary uppercase tracking-wider mb-2">
            {title}
          </h3>
          <p className="text-sm text-text-secondary leading-relaxed mb-5">
            {message}
          </p>

          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-mono font-medium text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors cursor-pointer"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              onClick={onConfirm}
              className={`px-3 py-1.5 text-xs font-mono font-semibold uppercase tracking-wider transition-all duration-200 cursor-pointer border ${
                isDanger
                  ? "bg-signal-error text-white border-signal-error hover:bg-signal-error/80"
                  : "bg-text-primary text-text-inverse border-text-primary hover:bg-transparent hover:text-text-primary"
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
