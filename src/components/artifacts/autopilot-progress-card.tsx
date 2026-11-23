"use client";

import {
  AUTOPILOT_STAGE_METADATA,
  AUTOPILOT_STAGES,
  type AutopilotRunView,
  type AutopilotStatus,
} from "@/lib/ano/autopilot";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";

export interface AutopilotProgressCardProps {
  autopilotRun: AutopilotRunView;
  isWorking?: boolean;
  onPause?: () => void;
  onResume?: () => void;
}

function statusBadgeLabel(status: AutopilotStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "completed_with_warnings":
      return "Completed with notes";
    case "failed":
      return "Stopped safely";
    case "cancelled":
      return "Cancelled";
    default:
      return "Ready";
  }
}

function statusBadgeClass(status: AutopilotStatus): string {
  switch (status) {
    case "completed":
      return "status-approved";
    case "completed_with_warnings":
    case "paused":
      return "status-awaiting_approval";
    case "failed":
    case "cancelled":
      return "status-failed_safe";
    case "running":
      return "status-running";
    default:
      return "status-neutral";
  }
}

export function AutopilotProgressCard({
  autopilotRun,
  isWorking = false,
  onPause,
  onResume,
}: AutopilotProgressCardProps) {
  useMaterialWeb();

  const completedSet = new Set(autopilotRun.completedStages);
  const completedCount = autopilotRun.completedStages.length;
  const totalCount = AUTOPILOT_STAGES.length;
  const progressValue = completedCount / totalCount;
  const activeStageMeta = AUTOPILOT_STAGE_METADATA.find(
    (item) => item.stage === autopilotRun.currentStage,
  );
  const displayStepNumber =
    activeStageMeta?.stepNumber ?? Math.min(completedCount + 1, totalCount);
  const isRunning = autopilotRun.status === "running";
  const canResume =
    autopilotRun.status === "paused" ||
    autopilotRun.status === "cancelled" ||
    autopilotRun.status === "failed" ||
    autopilotRun.status === "idle";

  return (
    <article className="m3-artifact-card m3-autopilot-card" aria-label="Autopilot pipeline progress">
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">AUTOPILOT PIPELINE</p>
          <h2>
            {autopilotRun.status === "completed" || autopilotRun.status === "completed_with_warnings"
              ? `Pipeline complete (${totalCount}/${totalCount} stages)`
              : autopilotRun.status === "running"
                ? `Running stage ${displayStepNumber} of ${totalCount}`
                : autopilotRun.status === "paused"
                  ? `Paused at stage ${displayStepNumber} of ${totalCount}`
                  : autopilotRun.status === "failed"
                    ? "Pipeline stopped safely"
                    : "Autopilot ready"}
          </h2>
        </div>
        <span className={`m3-status-badge ${statusBadgeClass(autopilotRun.status)}`}>
          {statusBadgeLabel(autopilotRun.status)}
        </span>
      </header>

      <div className="m3-autopilot-progress-wrap">
        <md-linear-progress
          value={progressValue}
          max={1}
          indeterminate={(isRunning && completedCount === 0) || undefined}
          aria-label="Autopilot pipeline progress"
        />
        <p className="m3-helper-note">
          {completedCount} of {totalCount} stages finished
        </p>
      </div>

      <ol className="m3-autopilot-stage-list">
        {AUTOPILOT_STAGE_METADATA.map((item) => {
          const summary = autopilotRun.stageSummaries[item.stage];
          const isDone = completedSet.has(item.stage);
          const isActive = isRunning && autopilotRun.currentStage === item.stage && !isDone;
          const isSkipped = summary?.status === "skipped";
          const hasWarning = summary?.status === "completed_with_warnings";

          let rowBadge = "Pending";
          let rowBadgeClass = "status-neutral";
          if (isSkipped) {
            rowBadge = "Skipped";
            rowBadgeClass = "status-awaiting_approval";
          } else if (hasWarning) {
            rowBadge = "Note";
            rowBadgeClass = "status-awaiting_approval";
          } else if (isDone) {
            rowBadge = "Done";
            rowBadgeClass = "status-approved";
          } else if (isActive) {
            rowBadge = "In progress";
            rowBadgeClass = "status-running";
          }

          return (
            <li
              key={item.stage}
              className={`m3-autopilot-stage-row ${isDone ? "is-done" : ""} ${isActive ? "is-active" : ""} ${hasWarning ? "is-warning" : ""}`}
            >
              <div className="m3-autopilot-stage-head">
                <div className="m3-autopilot-stage-title-wrap">
                  <span className="m3-autopilot-stage-index">{item.stepNumber}</span>
                  <strong className="m3-autopilot-stage-title">{item.title}</strong>
                </div>
                <span className={`m3-status-badge ${rowBadgeClass}`}>{rowBadge}</span>
              </div>
              <p className="m3-autopilot-stage-detail">
                {summary
                  ? `${summary.headline} — ${summary.detail}`
                  : isActive
                    ? item.activeHint
                    : "Waiting for earlier stages."}
              </p>
            </li>
          );
        })}
      </ol>

      {autopilotRun.warnings.length > 0 && (
        <div className="m3-muted-callout" role="status">
          <strong>Pipeline notes</strong>
          <ul className="m3-bullet-list">
            {autopilotRun.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {autopilotRun.lastError && (
        <div className="m3-warning-callout" role="status">
          <strong>Autopilot paused after an issue</strong>
          <p>{autopilotRun.lastError}</p>
        </div>
      )}

      {(isRunning || canResume) && (
        <footer className="m3-artifact-footer">
          <div className="m3-action-row">
            {isRunning && onPause && (
              <MaterialButton variant="outlined" onClick={onPause}>
                Pause
              </MaterialButton>
            )}
            {canResume && onResume && (
              <MaterialButton variant="filled" disabled={isWorking} onClick={onResume}>
                Resume autopilot
              </MaterialButton>
            )}
          </div>
        </footer>
      )}
    </article>
  );
}
