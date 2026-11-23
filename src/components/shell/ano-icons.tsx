"use client";

export function MenuIcon() {
  return (
    <md-icon aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
      </svg>
    </md-icon>
  );
}

export function CloseIcon() {
  return (
    <md-icon aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.7 2.88 18.3 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.29-6.3 1.42 1.42Z" />
      </svg>
    </md-icon>
  );
}

export function PanelRightIcon() {
  return (
    <md-icon aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v12h10V6H4Zm12 0v12h4V6h-4Z" />
      </svg>
    </md-icon>
  );
}

export function AddIcon() {
  return (
    <md-icon slot="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6Z" />
      </svg>
    </md-icon>
  );
}

export function SunIcon({ slot }: { slot?: "icon" }) {
  return (
    <md-icon slot={slot} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5h-1v3h2V2h-1Zm0 17h-1v3h2v-3h-1ZM5 11H2v2h3v-2Zm17 0h-3v2h3v-2ZM6.34 4.93 4.93 6.34l2.12 2.12 1.41-1.41-2.12-2.12Zm10.61 10.61-1.41 1.41 2.12 2.12 1.41-1.41-2.12-2.12Zm0-10.61-2.12 2.12 1.41 1.41 2.12-2.12-1.41-1.41ZM7.05 15.54l-2.12 2.12 1.41 1.41 2.12-2.12-1.41-1.41Z" />
      </svg>
    </md-icon>
  );
}

export function MoonIcon({ slot }: { slot?: "icon" }) {
  return (
    <md-icon slot={slot} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M12.3 3a9 9 0 1 0 8.7 11.3A7 7 0 0 1 12.3 3Z" />
      </svg>
    </md-icon>
  );
}

export function AttachFileIcon({ slot }: { slot?: "icon" }) {
  return (
    <md-icon slot={slot} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5Z" />
      </svg>
    </md-icon>
  );
}

export function LinkIcon({ slot }: { slot?: "icon" }) {
  return (
    <md-icon slot={slot} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1ZM8 13h8v-2H8v2Zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5Z" />
      </svg>
    </md-icon>
  );
}
