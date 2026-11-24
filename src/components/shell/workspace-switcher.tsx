"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { WorkspaceIdentity } from "@/contracts/ano";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";

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
  useMaterialWeb();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    function handleClosed() {
      setOpen(false);
    }
    menu.addEventListener("closed", handleClosed);
    return () => menu.removeEventListener("closed", handleClosed);
  }, []);

  const allWorkspaces = workspaces.length > 0 ? workspaces : [activeWorkspace];

  return (
    <div className="ano-ws-switcher">
      <MaterialButton
        id="ano-ws-switcher-anchor"
        variant="tonal"
        ariaLabel={`Active workspace ${activeWorkspace.name}. Switch workspace or account options.`}
        disabled={isSwitching}
        onClick={() => setOpen((prev) => !prev)}
      >
        {`${activeWorkspace.name} · ${activeWorkspace.role}`}
      </MaterialButton>

      <md-menu
        ref={menuRef}
        id="ano-ws-switcher-menu"
        anchor="ano-ws-switcher-anchor"
        positioning="popover"
        menu-corner="start-end"
        anchor-corner="end-end"
        open={open || undefined}
        aria-label="Workspaces and account"
      >
        {actorEmail && (
          <md-menu-item disabled>
            <div slot="headline">{actorEmail}</div>
            <div slot="supporting-text">Signed in</div>
          </md-menu-item>
        )}
        {actorEmail && <md-divider />}

        {allWorkspaces.map((item) => {
          const isActive = item.id === activeWorkspace.id;
          return (
            <md-menu-item
              key={item.id}
              type="button"
              selected={isActive || undefined}
              disabled={isSwitching || undefined}
              onClick={() => {
                setOpen(false);
                if (!isActive) {
                  void onSwitchWorkspace(item.id);
                }
              }}
            >
              <div slot="headline">{item.name}</div>
              <div slot="supporting-text">
                /{item.slug} · {item.role}
              </div>
              {isActive && <span slot="end">Active</span>}
            </md-menu-item>
          );
        })}

        <md-divider />

        <md-menu-item
          type="button"
          onClick={() => {
            setOpen(false);
            router.push("/onboarding?new=1");
          }}
        >
          <div slot="headline">+ Create workspace</div>
        </md-menu-item>
        <md-menu-item
          type="button"
          onClick={() => {
            setOpen(false);
            router.push("/settings");
          }}
        >
          <div slot="headline">Workspace settings</div>
        </md-menu-item>
        <md-menu-item
          type="button"
          onClick={() => {
            setOpen(false);
            void onSignOut();
          }}
        >
          <div slot="headline">Sign out</div>
        </md-menu-item>
      </md-menu>
    </div>
  );
}
