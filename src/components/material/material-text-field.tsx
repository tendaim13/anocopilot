"use client";

import type { FormEvent, KeyboardEvent } from "react";

import { useMaterialWeb } from "./register";

export interface MaterialTextFieldProps {
  id?: string;
  name?: string;
  label: string;
  type?: "text" | "email" | "password" | "textarea" | "url" | "search";
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  supportingText?: string;
  errorText?: string;
  error?: boolean;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  rows?: number;
  autoComplete?: string;
  ariaLabel?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  className?: string;
}

/**
 * Narrow adapter over `<md-outlined-text-field>`. Preserves native form Enter
 * submission for single-line fields across the Shadow DOM boundary.
 */
export function MaterialTextField({
  id,
  name,
  label,
  type = "text",
  value,
  onValueChange,
  placeholder,
  supportingText,
  errorText,
  error = false,
  required = false,
  disabled = false,
  readOnly = false,
  minLength,
  maxLength,
  rows,
  autoComplete,
  ariaLabel,
  onKeyDown,
  className,
}: MaterialTextFieldProps) {
  const ready = useMaterialWeb();

  function handleInput(event: FormEvent<HTMLElement>) {
    const target = event.currentTarget as unknown as { value?: string };
    onValueChange(typeof target.value === "string" ? target.value : "");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      type === "textarea" ||
      event.key !== "Enter" ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    const form = event.currentTarget.closest("form");
    if (form) {
      event.preventDefault();
      form.requestSubmit();
    }
  }

  return (
    <md-outlined-text-field
      id={id}
      name={name}
      label={label}
      type={type}
      value={value}
      placeholder={placeholder}
      supporting-text={supportingText || undefined}
      error-text={errorText || undefined}
      error={ready ? error : error || undefined}
      required={ready ? required : required || undefined}
      disabled={ready ? disabled : disabled || undefined}
      readOnly={ready ? readOnly : readOnly || undefined}
      minLength={minLength}
      maxLength={maxLength}
      rows={rows}
      autocomplete={autoComplete}
      aria-label={ariaLabel}
      className={className}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
    />
  );
}
