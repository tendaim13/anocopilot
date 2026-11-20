"use client";

import { useEffect, useRef } from "react";

import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";

export interface ApprovalCardProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  isWorking?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Material 3 confirmation dialog (`<md-dialog>`) reserved for high-impact or
 * destructive conversation decisions such as declining a plan or archiving.
 */
export function ApprovalCard({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  isWorking = false,
  onConfirm,
  onCancel,
}: ApprovalCardProps) {
  useMaterialWeb();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClosed() {
      onCancel();
    }
    dialog.addEventListener("closed", handleClosed);
    return () => dialog.removeEventListener("closed", handleClosed);
  }, [onCancel]);

  return (
    <md-dialog ref={dialogRef} open={open || undefined} type="alert">
      <div slot="headline">{title}</div>
      <div slot="content" className="ano-dialog-body">
        <p className="m3-dialog-copy">{body}</p>
      </div>
      <div slot="actions">
        <MaterialButton variant="text" disabled={isWorking} onClick={onCancel}>
          {cancelLabel}
        </MaterialButton>
        <MaterialButton variant="filled" disabled={isWorking} onClick={onConfirm}>
          {isWorking ? "Working…" : confirmLabel}
        </MaterialButton>
      </div>
    </md-dialog>
  );
}
