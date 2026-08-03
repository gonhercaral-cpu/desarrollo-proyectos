function getNotificationMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const seconds = Number(value.seconds ?? value._seconds);
  if (Number.isFinite(seconds)) return seconds * 1000;

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function buildUnreadActivityByProject(notifications = []) {
  return notifications.reduce((activityByProject, notification) => {
    const projectId = String(notification?.entityId || notification?.projectId || "").trim();

    if (!projectId || notification.read === true) return activityByProject;

    const current = activityByProject[projectId] || {
      count: 0,
      hasNewComments: false,
      latestActivityAt: null,
    };
    const notificationMillis = getNotificationMillis(notification.createdAt);
    const currentMillis = getNotificationMillis(current.latestActivityAt);

    activityByProject[projectId] = {
      count: current.count + 1,
      hasNewComments:
        current.hasNewComments ||
        String(notification.type || notification.tipo || "").toLowerCase().includes("comment"),
      latestActivityAt:
        notificationMillis >= currentMillis
          ? notification.createdAt || current.latestActivityAt
          : current.latestActivityAt,
    };

    return activityByProject;
  }, {});
}
