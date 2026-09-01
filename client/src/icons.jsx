// Minimal, hand-authored line icons — 20x20, 1.6px stroke, no external icon font.
const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function IconUpload(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 12.5V3.5" />
      <path d="M6.5 7 10 3.5 13.5 7" />
      <path d="M4 13v1.5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V13" />
    </svg>
  );
}

export function IconPaperclip(props) {
  return (
    <svg {...base} {...props}>
      <path d="M13.5 7.5 8.2 12.8a2.4 2.4 0 0 1-3.4-3.4l5.9-5.9a3.6 3.6 0 0 1 5 5l-6 6a1.2 1.2 0 0 1-1.7-1.7l5.3-5.3" />
    </svg>
  );
}

export function IconCheck(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10.5 8 14.5 16 6" />
    </svg>
  );
}

export function IconArrowLeft(props) {
  return (
    <svg {...base} {...props}>
      <path d="M16 10H4" />
      <path d="M8.5 5.5 4 10l4.5 4.5" />
    </svg>
  );
}

export function IconDownload(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3v9" />
      <path d="M6.5 8.5 10 12l3.5-3.5" />
      <path d="M4 14.5V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5" />
    </svg>
  );
}

export function IconFileText(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 2.5h6l3 3V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path d="M12 2.5V6h3" />
      <path d="M7.2 10h5.6M7.2 12.5h5.6M7.2 7.5h2" />
    </svg>
  );
}

export function IconExternal(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8.5 4.5H4a1 1 0 0 0-1 1V16a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1v-4.5" />
      <path d="M11 3h6v6" />
      <path d="M17 3 9.5 10.5" />
    </svg>
  );
}

export function IconMail(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 5.5h14a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
      <path d="m2.4 6 7.6 5.5L17.6 6" />
    </svg>
  );
}

export function IconSparkle(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 2.5 11.4 8 17 9.5 11.4 11 10 16.5 8.6 11 3 9.5 8.6 8Z" />
    </svg>
  );
}
