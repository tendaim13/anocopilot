"use client";

import type { MouseEvent, ReactNode } from "react";

import { useMaterialWeb } from "./register";

export type MaterialIconButtonVariant = "standard" | "filled" | "outlined";

export interface MaterialIconButtonProps {
  id?: string;
  variant?: MaterialIconButtonVariant;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  toggle?: boolean;
  selected?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  ariaLabel: string;
  ariaExpanded?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Narrow adapter over Material Web icon buttons requiring an accessible
 * `ariaLabel` on every compact action.
 */
export function MaterialIconButton({
  id,
  variant = "standard",
  type = "button",
  disabled = false,
  toggle = false,
  selected = false,
  onClick,
  ariaLabel,
  ariaExpanded,
  className,
  children,
}: MaterialIconButtonProps) {
  const ready = useMaterialWeb();

  const sharedProps = {
    id,
    type,
    className,
    disabled: ready ? disabled : disabled || undefined,
    toggle: ready ? toggle : toggle || undefined,
    selected: ready ? selected : selected || undefined,
    "aria-label": ariaLabel,
    "aria-expanded": ariaExpanded,
    onClick,
  };

  if (variant === "filled") {
    return <md-filled-icon-button {...sharedProps}>{children}</md-filled-icon-button>;
  }
  if (variant === "outlined") {
    return <md-outlined-icon-button {...sharedProps}>{children}</md-outlined-icon-button>;
  }
  return <md-icon-button {...sharedProps}>{children}</md-icon-button>;
}
