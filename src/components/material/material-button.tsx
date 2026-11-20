"use client";

import type { MouseEvent, ReactNode } from "react";

import { useMaterialWeb } from "./register";

export type MaterialButtonVariant = "filled" | "tonal" | "outlined" | "text";

export interface MaterialButtonProps {
  id?: string;
  variant?: MaterialButtonVariant;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  softDisabled?: boolean;
  name?: string;
  value?: string;
  href?: string;
  target?: "_blank" | "_parent" | "_self" | "_top" | "";
  trailingIcon?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}

const TAG_BY_VARIANT: Record<MaterialButtonVariant, string> = {
  filled: "md-filled-button",
  tonal: "md-filled-tonal-button",
  outlined: "md-outlined-button",
  text: "md-text-button",
};

/**
 * Narrow adapter over Material Web button elements. Handles pre-upgrade submit
 * or reset clicks safely without double-submitting once the custom element is
 * registered.
 */
export function MaterialButton({
  id,
  variant = "filled",
  type = "button",
  disabled = false,
  softDisabled = false,
  name,
  value,
  href,
  target,
  trailingIcon = false,
  onClick,
  ariaLabel,
  className,
  children,
}: MaterialButtonProps) {
  const ready = useMaterialWeb();
  const tagName = TAG_BY_VARIANT[variant];

  function handleClick(event: MouseEvent<HTMLElement>) {
    onClick?.(event);
    if (event.defaultPrevented || disabled || softDisabled || href) {
      return;
    }
    if (type !== "submit" && type !== "reset") {
      return;
    }
    // Material Web's ElementInternals form submitter only runs after upgrade.
    // Fallback only if the user clicks before the custom element is defined.
    const isDefined = typeof customElements !== "undefined" && Boolean(customElements.get(tagName));
    if (isDefined) {
      return;
    }
    const form = event.currentTarget.closest("form");
    if (!form) {
      return;
    }
    if (type === "reset") {
      form.reset();
    } else {
      form.requestSubmit();
    }
  }

  const sharedProps = {
    id,
    type,
    name,
    value,
    href,
    target,
    className,
    disabled: ready ? disabled : disabled || undefined,
    "soft-disabled": softDisabled || undefined,
    "trailing-icon": trailingIcon || undefined,
    "aria-label": ariaLabel,
    onClick: handleClick,
  };

  if (variant === "tonal") {
    return <md-filled-tonal-button {...sharedProps}>{children}</md-filled-tonal-button>;
  }
  if (variant === "outlined") {
    return <md-outlined-button {...sharedProps}>{children}</md-outlined-button>;
  }
  if (variant === "text") {
    return <md-text-button {...sharedProps}>{children}</md-text-button>;
  }
  return <md-filled-button {...sharedProps}>{children}</md-filled-button>;
}
