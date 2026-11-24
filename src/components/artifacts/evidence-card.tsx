"use client";

import { useMemo, useState } from "react";

import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";

export interface EvidenceCardProps {
  research: EvidenceResearchView;
  onOpenContextRail: () => void;
}

export function EvidenceCard({ research, onOpenContextRail }: EvidenceCardProps) {
  useMaterialWeb();
  const [selectedClass, setSelectedClass] = useState<string>("all");

  const sourceClasses = useMemo(
    () => Array.from(new Set(research.sources.map((source) => source.sourceClass))),
    [research.sources],
  );

  const visibleSources = useMemo(
    () =>
      selectedClass === "all"
        ? research.sources
        : research.sources.filter((source) => source.sourceClass === selectedClass),
    [research.sources, selectedClass],
  );

  if (research.sources.length === 0) return null;

  return (
    <article className="m3-artifact-card" aria-label="Saved evidence source ledger">
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">Market Sources</p>
          <h2>
            {research.sources.length} saved source{research.sources.length === 1 ? "" : "s"}
          </h2>
        </div>
        <MaterialButton variant="text" onClick={onOpenContextRail}>
          Open context rail
        </MaterialButton>
      </header>

      {sourceClasses.length > 1 && (
        <md-chip-set aria-label="Filter saved sources by source class">
          <md-filter-chip
            selected={selectedClass === "all"}
            onClick={() => setSelectedClass("all")}
          >
            All ({research.sources.length})
          </md-filter-chip>
          {sourceClasses.map((sourceClass) => (
            <md-filter-chip
              key={sourceClass}
              selected={selectedClass === sourceClass}
              onClick={() => setSelectedClass(sourceClass)}
            >
              {sourceClass}
            </md-filter-chip>
          ))}
        </md-chip-set>
      )}

      <div className="m3-evidence-source-grid">
        {visibleSources.slice(0, 8).map((source) => (
          <article key={source.id} className="m3-evidence-source-item">
            <div className="m3-evidence-source-top">
              <span className="m3-claim-pill">Source observation</span>
              <span className="m3-source-tag">{source.sourceClass}</span>
            </div>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title}
            </a>
            <p>
              {source.excerpt ??
                "This source could not be retrieved safely; Ano retained its safe failure record."}
            </p>
            <small>
              {source.status === "fetched" ? "Retrieved" : "Not retrieved"} ·{" "}
              {new Date(source.retrievedAt).toLocaleDateString()}
            </small>
          </article>
        ))}
      </div>

      {visibleSources.length > 8 && (
        <footer className="m3-artifact-footer">
          <p className="m3-helper-note">
            Showing 8 of {visibleSources.length} matching sources. Open the context rail to inspect
            every saved URL.
          </p>
        </footer>
      )}
    </article>
  );
}
