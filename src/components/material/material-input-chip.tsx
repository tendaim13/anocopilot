"use client";

import { useEffect, useRef } from "react";

import { useMaterialWeb } from "./register";

export interface MaterialInputChipProps {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  removeOnly?: boolean;
  onRemove?: () => void;
}

/**
 * Narrow adapter over `<md-input-chip>`. Prevents native DOM self-removal on
 * the Web Component's `remove` event so React state controls list unmounting.
 */
export function MaterialInputChip({
  label,
  selected = false,
  disabled = false,
  removeOnly = false,
  onRemove,
}: MaterialInputChipProps) {
  useMaterialWeb();
  const chipRef = useRef<HTMLElement>(null);
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;

  useEffect(() => {
    const chip = chipRef.current;
    if (!chip) return;
    function handleRemove(event: Event) {
      event.preventDefault();
      onRemoveRef.current?.();
    }
    chip.addEventListener("remove", handleRemove);
    return () => chip.removeEventListener("remove", handleRemove);
  }, []);

  return (
    <md-input-chip
      ref={chipRef}
      label={label}
      selected={selected || undefined}
      disabled={disabled || undefined}
      remove-only={removeOnly || undefined}
    />
  );
}
