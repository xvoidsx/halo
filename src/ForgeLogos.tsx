// Forge marks for the sidebar switcher. Both are the vendors' own
// marks, used unmodified and only to indicate which platform the
// list below comes from — GitHub's brand page explicitly permits
// this ("Show integration — Use a permitted GitHub logo to inform
// others that your project integrates with GitHub"); the Entire mark
// is their favicon SVG (entire.com/favicon-dark.svg), same use.
// Neither is Halo's own branding, and neither implies endorsement.
// Both render in currentColor so the switcher can dim the inactive
// forge; GitHub's mark is only ever white/black/grey per their
// guidelines, and Entire's ships white.

export function EntireMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M17.6.22c1.61-.43,3.33-.21,4.77.61l7.47,4.25c.31.18.25.64-.09.73l-16.75,4.49c-1.69.45-2.69,2.19-2.24,3.88l.82,3.06c.45,1.69,2.19,2.69,3.88,2.24l9.57-2.5,4.61,4.74c.89.89,1.39,2.1,1.39,3.36v2.54c0,1.65-1.27,3.03-2.92,3.16l-15.61,1.2c-1.85.14-3.67-.53-4.98-1.85l-5.11-5.14c-.88-.89-1.38-2.09-1.38-3.35v-2.55c0-1.65,1.5-3.08,3-3.08h2l-3.85-3.04c-.6-.43-1.04-1.05-1.23-1.76l-.81-3.03c-.45-1.69.55-3.43,2.24-3.88L17.6.22Z" />
      <path d="M20.02,13.94c0,1.38-1.12,2.5-2.5,2.5s-2.5-1.12-2.5-2.5,1.12-2.5,2.5-2.5,2.5,1.12,2.5,2.5Z" />
      <path d="M28.02,11.94c0,1.38-1.12,2.5-2.5,2.5s-2.5-1.12-2.5-2.5,1.12-2.5,2.5-2.5,2.5,1.12,2.5,2.5Z" />
    </svg>
  );
}

export function GitHubMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
