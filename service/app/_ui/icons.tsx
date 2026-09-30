/* Outline icons, 24 unit grid, drawn with the current colour. Inline so the console
   needs nothing from a CDN. */

const PATHS: Record<string, React.ReactNode> = {
  map: (
    <>
      <path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z" />
      <path d="M9 4v13M15 7v13" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  compare: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M11 6h5a2 2 0 0 1 2 2v8M14 9l-3-3 3-3M13 18H8a2 2 0 0 1-2-2V8M10 15l3 3-3 3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  checklist: <path d="M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  play: <path d="M7 4v16l13-8z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  external: <path d="M11 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5M10 14 20 4M15 4h5v5" />,
  book: <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M16 8l-2 6-6 2 2-6z" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  refresh: <path d="M20 11A8 8 0 0 0 5.6 6.6L4 8M4 4v4h4M4 13a8 8 0 0 0 14.4 4.4L20 16M20 20v-4h-4" />,
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  layers: <path d="M12 4 3 9l9 5 9-5zM3 14l9 5 9-5" />,
  route: (
    <>
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" />
    </>
  ),
  check: <path d="M5 12l5 5L20 7" />,
  circle: <circle cx="12" cy="12" r="8" />,
  bolt: <path d="M13 3 4 14h7l-1 7 9-11h-7z" />,
  note: <path d="M5 4h10l4 4v12H5zM15 4v4h4M9 13h6M9 17h4" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  back: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  maximize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minus: <path d="M5 12h14" />,
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3M14 9l2 2" />
    </>
  ),
};

export function Icon({ name, size = 15, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ flex: 'none', ...style }}
    >
      {PATHS[name] ?? PATHS.circle}
    </svg>
  );
}

/* The Sekva mark: one line between two stations, the next step. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill="#4f46e5" />
      <path d="M7 16.2h4.3c1.6 0 2.4-.9 2.4-2.2v-4c0-1.3.8-2.2 2.4-2.2H17" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="7" cy="16.2" r="1.9" fill="#fff" />
      <circle cx="17" cy="7.8" r="1.9" fill="#fff" />
    </svg>
  );
}
