"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { WorkspaceIdentity } from "@/contracts/ano";
import { MaterialButton } from "@/components/material/material-button";

export interface WorkspaceSwitcherProps {
  activeWorkspace: WorkspaceIdentity;
  workspaces: WorkspaceIdentity[];
  actorEmail: string | null;
  isSwitching?: boolean;
  onSwitchWorkspace: (workspaceId: string) => Promise<void> | void;
  onSignOut: () => Promise<void> | void;
}

export function WorkspaceSwitcher({
  activeWorkspace,
  workspaces,
  actorEmail,
  isSwitching = false,
  onSwitchWorkspace,
  onSignOut,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const allWorkspaces = workspaces.length > 0 ? workspaces : [activeWorkspace];

  return (
    <div ref={containerRef} className="ano-ws-switcher">
      <button
        type="button"
        className="ano-ws-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Active workspace ${activeWorkspace.name}. Switch workspace or account options.`}
        disabled={isSwitching}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="ano-ws-dot" aria-hidden="true" />
        <span className="ano-ws-trigger-name">{activeWorkspace.name}</span>
        <span className="ano-ws-role-pill">{activeWorkspace.role}</span>
        <span className="ano-ws-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="ano-ws-menu" role="menu" aria-label="Workspaces and account">
          {actorEmail && (
            <div className="ano-ws-menu-header">
              <span className="ano-ws-menu-kicker">SIGNED IN AS</span>
              <strong>{actorEmail}</strong>
            </div>
          )}

          <div className="ano-ws-menu-section">
            <span className="ano-ws-menu-kicker">
              WORKSPACES ({allWorkspaces.length})
            </span>
            <div className="ano-ws-option-list">
              {allWorkspaces.map((item) => {
                const isActive = item.id === activeWorkspace.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`ano-ws-option${isActive ? " is-active" : ""}`}
                    disabled={isSwitching}
                    onClick={() => {
                      setOpen(false);
                      if (!isActive) {
                        void onSwitchWorkspace(item.id);
                      }
                    }}
                  >
                    <span className="ano-ws-option-main">
                      <strong>{item.name}</strong>
                      <small>/{item.slug}</small>
                    </span>
                    <span className="ano-ws-option-meta">
                      <span className="ano-ws-role-pill">{item.role}</span>
                      {isActive && <span className="ano-ws-check" aria-hidden="true">✓</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ano-ws-divider" />

          <div className="ano-ws-footer-actions">
            <MaterialButton
              variant="text"
              onClick={() => {
                setOpen(false);
                router.push("/onboarding?new=1");
              }}
            >
              + Create workspace
            </MaterialButton>
            <MaterialButton
              variant="text"
              onClick={() => {
                setOpen(false);
                router.push("/settings");
              }}
            >
              Workspace settings
            </MaterialButton>
            <MaterialButton
              variant="text"
              onClick={() => {
                setOpen(false);
                void onSignOut();
              }}
            >
              Sign out
            </MaterialButton>
          </div>
        </div>
      )}
    </div>
  );
}
