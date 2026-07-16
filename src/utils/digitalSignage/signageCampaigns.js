export function timeToMinutes(value = "") {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

export function getCampaignPriorityWeight(priority) {
  const normalizedPriority = String(priority || "normal").toLowerCase();
  if (normalizedPriority === "urgente") return 3;
  if (normalizedPriority === "alta") return 2;
  return 1;
}

export function getCampaignPriorityLabel(priority) {
  const labels = {
    urgente: "Urgente",
    alta: "Alta",
    normal: "Normal",
  };

  return labels[priority] || "Normal";
}

export function compareCampaignPriority(first, second) {
  return getCampaignPriorityWeight(second.priority) - getCampaignPriorityWeight(first.priority);
}

export function formatWeekdayRange(days) {
  if (!Array.isArray(days) || days.length === 0) return "Sin días";
  const sorted = [...days].sort((first, second) => first - second);
  const labels = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  if (sorted.length === 7) return "Todos los días";
  if (sorted.join(",") === "1,2,3,4,5") return "Lun-Vie";
  return sorted.map((day) => labels[day] || "").filter(Boolean).join(", ");
}

export function formatCampaignSchedule(schedule = {}) {
  if (schedule?.enabled !== true) return "Todo el día";

  return `${formatWeekdayRange(schedule.daysOfWeek)} · ${schedule.startTime || "--:--"}-${schedule.endTime || "--:--"}`;
}
