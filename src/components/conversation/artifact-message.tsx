"use client";

import type { ReactNode } from "react";

export interface ArtifactMessageProps {
  label: string;
  timestamp?: string;
  children: ReactNode;
}

/**
 * Wraps each structured research artifact inside the chronological conversation
 * stream so plans, provider scopes, evidence, and route decisions read as
 * traceable thread events.
 */
export function ArtifactMessage({ label, timestamp, children }: ArtifactMessageProps) {
  return (
    <div className="m3-artifact-envelope">
      <div className="m3-artifact-attribution">
        <span>Ano · {label}</span>
        {timestamp && (
          <time>
            {new Date(timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        )}
      </div>
      {children}
    </div>
  );
}
