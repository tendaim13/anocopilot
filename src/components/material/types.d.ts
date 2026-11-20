import type * as React from "react";

type MaterialHtmlProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

interface MaterialButtonProps extends MaterialHtmlProps {
  disabled?: boolean;
  softDisabled?: boolean;
  "soft-disabled"?: boolean;
  href?: string;
  download?: string;
  target?: "_blank" | "_parent" | "_self" | "_top" | "";
  trailingIcon?: boolean;
  "trailing-icon"?: boolean;
  hasIcon?: boolean;
  "has-icon"?: boolean;
  type?: "button" | "submit" | "reset";
  value?: string;
  name?: string;
  "aria-label"?: string;
}

interface MaterialIconProps extends MaterialHtmlProps {
  slot?: string;
}

interface MaterialIconButtonProps extends MaterialHtmlProps {
  disabled?: boolean;
  softDisabled?: boolean;
  "soft-disabled"?: boolean;
  href?: string;
  download?: string;
  target?: "_blank" | "_parent" | "_self" | "_top" | "";
  ariaLabelSelected?: string;
  "aria-label-selected"?: string;
  toggle?: boolean;
  selected?: boolean;
  type?: "button" | "submit" | "reset";
  value?: string;
  name?: string;
  "aria-label"?: string;
}

interface MaterialFabProps extends MaterialHtmlProps {
  variant?: "surface" | "primary" | "secondary" | "tertiary";
  size?: "medium" | "small" | "large";
  label?: string;
  lowered?: boolean;
  "aria-label"?: string;
}

interface MaterialOutlinedTextFieldProps extends MaterialHtmlProps {
  id?: string;
  name?: string;
  label?: string;
  type?: "email" | "number" | "password" | "search" | "tel" | "text" | "url" | "textarea";
  value?: string;
  placeholder?: string;
  supportingText?: string;
  "supporting-text"?: string;
  errorText?: string;
  "error-text"?: string;
  error?: boolean;
  required?: boolean;
  noAsterisk?: boolean;
  "no-asterisk"?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  rows?: number;
  cols?: number;
  autocomplete?: string;
  inputMode?: string;
  pattern?: string;
  min?: string;
  max?: string;
  step?: string;
  multiple?: boolean;
  prefixText?: string;
  "prefix-text"?: string;
  suffixText?: string;
  "suffix-text"?: string;
  hasLeadingIcon?: boolean;
  "has-leading-icon"?: boolean;
  hasTrailingIcon?: boolean;
  "has-trailing-icon"?: boolean;
  "aria-label"?: string;
}

interface MaterialListProps extends MaterialHtmlProps {
  role?: string;
}

interface MaterialListItemProps extends MaterialHtmlProps {
  disabled?: boolean;
  type?: "text" | "button" | "link";
  href?: string;
  target?: "_blank" | "_parent" | "_self" | "_top" | "";
}

interface MaterialChipProps extends MaterialHtmlProps {
  disabled?: boolean;
  softDisabled?: boolean;
  "soft-disabled"?: boolean;
  elevated?: boolean;
  hasIcon?: boolean;
  "has-icon"?: boolean;
  label?: string;
  href?: string;
  download?: string;
  target?: "_blank" | "_parent" | "_self" | "_top" | "";
}

interface MaterialFilterChipProps extends MaterialChipProps {
  selected?: boolean;
  removable?: boolean;
  hasSelectedIcon?: boolean;
  "has-selected-icon"?: boolean;
  onRemove?: (event: Event) => void;
}

interface MaterialDialogProps extends MaterialHtmlProps {
  open?: boolean;
  quick?: boolean;
  returnValue?: string;
  type?: "alert";
  noFocusTrap?: boolean;
  "no-focus-trap"?: boolean;
  onOpen?: (event: Event) => void;
  onOpened?: (event: Event) => void;
  onClose?: (event: Event) => void;
  onClosed?: (event: Event) => void;
  onCancel?: (event: Event) => void;
}

interface MaterialMenuProps extends MaterialHtmlProps {
  anchor?: string;
  positioning?: "absolute" | "fixed" | "document" | "popover";
  quick?: boolean;
  hasOverflow?: boolean;
  "has-overflow"?: boolean;
  open?: boolean;
  anchorCorner?: string;
  "anchor-corner"?: string;
  menuCorner?: string;
  "menu-corner"?: string;
  stayOpenOnOutsideClick?: boolean;
  "stay-open-on-outside-click"?: boolean;
  stayOpenOnFocusout?: boolean;
  "stay-open-on-focusout"?: boolean;
  onOpening?: (event: Event) => void;
  onOpened?: (event: Event) => void;
  onClosing?: (event: Event) => void;
  onClosed?: (event: Event) => void;
}

interface MaterialMenuItemProps extends MaterialHtmlProps {
  disabled?: boolean;
  type?: "menuitem" | "option" | "button" | "link";
  href?: string;
  target?: "_blank" | "_parent" | "_self" | "_top" | "";
  keepOpen?: boolean;
  "keep-open"?: boolean;
  selected?: boolean;
}

interface MaterialProgressProps extends MaterialHtmlProps {
  value?: number;
  max?: number;
  indeterminate?: boolean;
  fourColor?: boolean;
  "four-color"?: boolean;
  "aria-label"?: string;
}

interface MaterialOutlinedSelectProps extends MaterialHtmlProps {
  label?: string;
  value?: string;
  name?: string;
  required?: boolean;
  noAsterisk?: boolean;
  "no-asterisk"?: boolean;
  disabled?: boolean;
  error?: boolean;
  errorText?: string;
  "error-text"?: string;
  supportingText?: string;
  "supporting-text"?: string;
  quick?: boolean;
  menuPositioning?: "absolute" | "fixed" | "popover";
  "menu-positioning"?: "absolute" | "fixed" | "popover";
  clampMenuWidth?: boolean;
  "clamp-menu-width"?: boolean;
  displayText?: string;
  "display-text"?: string;
  "aria-label"?: string;
}

interface MaterialSelectOptionProps extends MaterialHtmlProps {
  disabled?: boolean;
  selected?: boolean;
  value?: string;
  displayText?: string;
  "display-text"?: string;
}

interface MaterialTabsProps extends MaterialHtmlProps {
  autoActivate?: boolean;
  "auto-activate"?: boolean;
  activeTabIndex?: number;
}

interface MaterialTabProps extends MaterialHtmlProps {
  active?: boolean;
  hasIcon?: boolean;
  "has-icon"?: boolean;
  iconOnly?: boolean;
  "icon-only"?: boolean;
  inlineIcon?: boolean;
  "inline-icon"?: boolean;
}

interface MaterialCheckboxProps extends MaterialHtmlProps {
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  required?: boolean;
  value?: string;
  name?: string;
  "touch-target"?: "wrapper" | "none";
  "aria-label"?: string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-filled-button": MaterialButtonProps;
      "md-filled-tonal-button": MaterialButtonProps;
      "md-outlined-button": MaterialButtonProps;
      "md-text-button": MaterialButtonProps;
      "md-checkbox": MaterialCheckboxProps;
      "md-icon": MaterialIconProps;
      "md-icon-button": MaterialIconButtonProps;
      "md-filled-icon-button": MaterialIconButtonProps;
      "md-outlined-icon-button": MaterialIconButtonProps;
      "md-fab": MaterialFabProps;
      "md-outlined-text-field": MaterialOutlinedTextFieldProps;
      "md-list": MaterialListProps;
      "md-list-item": MaterialListItemProps;
      "md-chip-set": MaterialHtmlProps;
      "md-filter-chip": MaterialFilterChipProps;
      "md-suggestion-chip": MaterialChipProps;
      "md-assist-chip": MaterialChipProps;
      "md-dialog": MaterialDialogProps;
      "md-menu": MaterialMenuProps;
      "md-menu-item": MaterialMenuItemProps;
      "md-linear-progress": MaterialProgressProps;
      "md-circular-progress": MaterialProgressProps;
      "md-outlined-select": MaterialOutlinedSelectProps;
      "md-select-option": MaterialSelectOptionProps;
      "md-tabs": MaterialTabsProps;
      "md-primary-tab": MaterialTabProps;
      "md-secondary-tab": MaterialTabProps;
    }
  }
}

export {};
