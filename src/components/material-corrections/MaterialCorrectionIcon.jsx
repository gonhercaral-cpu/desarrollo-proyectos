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
