"use client";

import { MaterialIconButton } from "@/components/material/material-icon-button";
import { MenuIcon, MoonIcon, PanelRightIcon, SunIcon } from "./ano-icons";

export interface MobileToolbarProps {
  title: string;
  statusLabel?: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenSidebar: () => void;
  onToggleContextRail: () => void;
  contextRailOpen: boolean;
}

export function MobileToolbar({
  title,
  statusLabel,
  theme,
  onToggleTheme,
  onOpenSidebar,
  onToggleContextRail,
  contextRailOpen,
}: MobileToolbarProps) {
  return (
    <div className="ano-mobile-toolbar">
      <MaterialIconButton ariaLabel="Open navigation drawer" onClick={onOpenSidebar}>
        <MenuIcon />
      </MaterialIconButton>
      <div className="ano-mobile-title">
        <strong>{title}</strong>
        {statusLabel && <small>{statusLabel}</small>}
      </div>
      <div className="ano-mobile-actions">
        <MaterialIconButton
          ariaLabel={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </MaterialIconButton>
        <MaterialIconButton
          ariaLabel={contextRailOpen ? "Hide research context" : "Show research context"}
          toggle
          selected={contextRailOpen}
          ariaExpanded={contextRailOpen}
          onClick={onToggleContextRail}
        >
          <PanelRightIcon />
        </MaterialIconButton>
      </div>
    </div>
  );
}
