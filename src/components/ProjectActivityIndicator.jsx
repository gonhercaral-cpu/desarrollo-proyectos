export default function ProjectActivityIndicator({ activity, compact = false }) {
  if (!activity?.count) return null;

  const label = compact ? "Nuevo" : "Actividad nueva";
  const title = `${activity.count} ${
    activity.count === 1 ? "novedad pendiente" : "novedades pendientes"
  }${activity.hasNewComments ? ", incluyendo comentarios" : ""}`;

  return (
    <span
      className={`project-activity-indicator${compact ? " compact" : ""}`}
      title={title}
      aria-label={title}
    >
      <i aria-hidden="true" />
      {activity.hasNewComments && (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16v11H8l-4 4V5Z" />
        </svg>
      )}
      <span>{label}</span>
      <strong>{activity.count > 99 ? "99+" : activity.count}</strong>
    </span>
  );
}
