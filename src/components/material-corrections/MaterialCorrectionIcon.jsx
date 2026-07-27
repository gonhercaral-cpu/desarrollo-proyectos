const PATHS = {
  module: (
    <>
      <path d="M5 4h14v16H5z" />
      <path d="M8 8h8M8 12h5" />
      <path d="m13.5 16 1.6 1.6L19 13.7" />
    </>
  ),
  new: (
    <>
      <path d="M5 4h14v16H5z" />
      <path d="M8 9h8M8 13h5" />
      <path d="M16 15v4M14 17h4" />
    </>
  ),
  review: (
    <>
      <path d="M5 4h10v16H5z" />
      <path d="M8 8h4M8 12h3" />
      <circle cx="16.5" cy="15.5" r="3.5" />
      <path d="m19 18 2 2" />
    </>
  ),
  correction: (
    <>
      <path d="M4 18.5 14.8 7.7l2.5 2.5L6.5 21H4z" />
      <path d="m13.6 8.9 2.5 2.5M16 6.5l1.2-1.2a1.8 1.8 0 0 1 2.5 2.5L18.5 9" />
    </>
  ),
  publish: (
    <>
      <path d="M5 5h14v14H5z" />
      <path d="M12 16V8M9 11l3-3 3 3" />
    </>
  ),
  urgent: (
    <>
      <path d="M12 3 2.8 20h18.4z" />
      <path d="M12 9v5M12 17h.01" />
    </>
  ),
  completed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m7.8 12.2 2.8 2.8 5.8-6" />
    </>
  ),
  time: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  back: (
    <>
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h11" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17h.01" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  distribution: (
    <>
      <path d="M12 4v10M8 10l4 4 4-4" />
      <path d="M5 15v4h14v-4" />
    </>
  ),
  evidence: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  comments: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" />
      <path d="M4 4v4.6h4.6M12 8v4l3 2" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h12l2 2v14H5z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </>
  ),
  archive: (
    <>
      <path d="M4 7h16v13H4zM3 4h18v4H3z" />
      <path d="M9 12h6" />
    </>
  ),
  delete: (
    <>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
};

export default function MaterialCorrectionIcon({
  name = "module",
  className = "nav-svg-icon",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name] || PATHS.module}
    </svg>
  );
}
