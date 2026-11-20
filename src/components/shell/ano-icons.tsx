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
