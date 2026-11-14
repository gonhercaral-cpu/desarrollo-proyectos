import {
  CAMPAIGN_PRIORITIES,
  DIGITAL_SIGNAGE_PLANTELES,
  PUBLISH_STATUSES,
} from "./signageConstants.js";

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

function cleanCampaignText(value = "") {
  return String(value ?? "").trim();
}

function dedupeTexts(values) {
  return Array.from(new Set(values.map(cleanCampaignText).filter(Boolean)));
}

// Lista autoritativa de planteles. Un array `planteles` manda siempre (incluso vacío:
// nunca equivale a "todos"). Legacy: solo `plantel` -> [plantel]; sin ambos -> [].
export function getCampaignPlanteles(campaign) {
  if (Array.isArray(campaign?.planteles)) return dedupeTexts(campaign.planteles);
  return dedupeTexts([campaign?.plantel]);
}

// Campaña legacy sin planteles ni plantel: el matching antiguo la trataba como "todos".
export function isLegacyAllPlantelesCampaign(campaign) {
  return !Array.isArray(campaign?.planteles) && !cleanCampaignText(campaign?.plantel);
}

// Para precargar el editor: las legacy "todos" se convierten a lista explícita.
export function getCampaignPlantelesForEdit(campaign, allPlanteles = DIGITAL_SIGNAGE_PLANTELES) {
  return isLegacyAllPlantelesCampaign(campaign) ? [...allPlanteles] : getCampaignPlanteles(campaign);
}

export function campaignMatchesPlantel(campaign, plantel) {
  if (isLegacyAllPlantelesCampaign(campaign)) return true;
  return getCampaignPlanteles(campaign).includes(cleanCampaignText(plantel));
}

// Matching de un player: deviceIds restringe; planteles es autoritativo. En campañas
// legacy (sin array planteles) con deviceIds, el plantel no participa, como antes.
export function campaignMatchesDevice(campaign, device) {
  const deviceIds = dedupeTexts(Array.isArray(campaign?.deviceIds) ? campaign.deviceIds : []);

  if (deviceIds.length > 0) {
    const matchesDevice =
      deviceIds.includes(cleanCampaignText(device?.id)) ||
      deviceIds.includes(cleanCampaignText(device?.deviceToken));
    if (!matchesDevice) return false;
    return Array.isArray(campaign?.planteles) ? campaignMatchesPlantel(campaign, device?.plantel) : true;
  }

  return campaignMatchesPlantel(campaign, device?.plantel);
}

// Deduplica y valida contra la lista oficial; `legacyAllowed` permite conservar valores
// preexistentes de la campaña editada sin ampliar la lista oficial.
export function normalizeCampaignPlanteles(
  value,
  { allowed = DIGITAL_SIGNAGE_PLANTELES, legacyAllowed = [] } = {}
) {
  const planteles = dedupeTexts(Array.isArray(value) ? value : [value]);
  const permitted = new Set([...allowed, ...legacyAllowed.map(cleanCampaignText)]);
  const invalid = planteles.filter((plantel) => !permitted.has(plantel));

  if (invalid.length > 0) {
    throw new Error(`Plantel no válido: ${invalid.join(", ")}.`);
  }

  return planteles;
}

export function cleanCampaignTime(value = "") {
  const text = cleanCampaignText(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "";
}

export function campaignTimeToMinutes(value = "") {
  const [hours, minutes] = cleanCampaignTime(value).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1;
  return hours * 60 + minutes;
}

export function normalizeCampaignSchedule(schedule = {}) {
  const enabled = schedule?.enabled === true;
  const daysOfWeek = Array.isArray(schedule?.daysOfWeek)
    ? Array.from(
        new Set(
          schedule.daysOfWeek
            .map((day) => Number(day))
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        )
      ).sort((a, b) => a - b)
    : [];

  return {
    enabled,
    daysOfWeek: enabled ? daysOfWeek : [],
    startTime: enabled ? cleanCampaignTime(schedule?.startTime) : "",
    endTime: enabled ? cleanCampaignTime(schedule?.endTime) : "",
    timezone: cleanCampaignText(schedule?.timezone) || "America/Tijuana",
  };
}

export function validateCampaignSchedule(schedule) {
  if (schedule.enabled !== true) return;

  if (!schedule.daysOfWeek.length) {
    throw new Error("Selecciona al menos un dia para la programacion.");
  }

  if (!schedule.startTime || !schedule.endTime) {
    throw new Error("Completa hora inicio y hora fin.");
  }

  if (campaignTimeToMinutes(schedule.endTime) <= campaignTimeToMinutes(schedule.startTime)) {
    throw new Error("La hora fin debe ser posterior a la hora inicio.");
  }
}

// Normaliza el documento completo de campaña. `existing` aporta los planteles legacy que
// siguen permitidos al editar. `plantelesTouched: false` omite plantel/planteles del payload
// (ediciones que no los modifican, p. ej. sobre una campaña legacy "todos").
export function normalizeCampaignPayload(data = {}, { existing = null, plantelesTouched = true } = {}) {
  const schedule = normalizeCampaignSchedule(data.schedule);
  validateCampaignSchedule(schedule);

  const payload = {
    name: cleanCampaignText(data.name),
    playlistId: cleanCampaignText(data.playlistId),
    priority: CAMPAIGN_PRIORITIES.includes(data.priority) ? data.priority : "normal",
    startDate: cleanCampaignText(data.startDate),
    endDate: cleanCampaignText(data.endDate),
    active: data.active !== false,
    publishStatus: PUBLISH_STATUSES.includes(data.publishStatus) ? data.publishStatus : "published",
    deviceIds: dedupeTexts(Array.isArray(data.deviceIds) ? data.deviceIds : []),
    schedule,
  };

  if (plantelesTouched) {
    const source = Array.isArray(data.planteles) ? data.planteles : [data.plantel];
    const planteles = normalizeCampaignPlanteles(source, {
      legacyAllowed: existing ? getCampaignPlanteles(existing) : [],
    });
    payload.planteles = planteles;
    payload.plantel = planteles[0] || "";
  }

  return payload;
}

export function validateCampaignPayload(payload, { requirePlanteles = true } = {}) {
  if (!payload.name) throw new Error("Completa el nombre de la campaña.");

  if (requirePlanteles && !(Array.isArray(payload.planteles) && payload.planteles.length > 0)) {
    throw new Error("Selecciona al menos un plantel.");
  }

  if (!payload.playlistId) throw new Error("Selecciona una playlist.");

  if (!payload.startDate || !payload.endDate) {
    throw new Error("Completa fecha inicio y fecha fin.");
  }

  if (payload.endDate < payload.startDate) {
    throw new Error("La fecha fin debe ser posterior a la fecha inicio.");
  }
}

const STATUS_ONLY_KEYS = ["active", "publishStatus"];

// Combina el documento actual con cambios parciales y devuelve el payload a escribir.
// Los cambios solo de estado (active/publishStatus) no tocan nada más; el resto se
// valida completo sobre el documento combinado (deviceIds y schedule se conservan).
export function buildCampaignUpdate(current = {}, changes = {}) {
  const keys = Object.keys(changes).filter((key) => changes[key] !== undefined);

  if (keys.length > 0 && keys.every((key) => STATUS_ONLY_KEYS.includes(key))) {
    const update = {};
    if (changes.active !== undefined) update.active = changes.active !== false;
    if (changes.publishStatus !== undefined) {
      update.publishStatus = PUBLISH_STATUSES.includes(changes.publishStatus)
        ? changes.publishStatus
        : "published";
    }
    return update;
  }

  const plantelesTouched = changes.planteles !== undefined || changes.plantel !== undefined;
  const merged = { ...current };
  keys.forEach((key) => {
    merged[key] = changes[key];
  });
  if (changes.planteles === undefined && changes.plantel !== undefined) {
    merged.planteles = [changes.plantel];
  }

  const payload = normalizeCampaignPayload(merged, { existing: current, plantelesTouched });
  validateCampaignPayload(payload, { requirePlanteles: plantelesTouched });

  if (!plantelesTouched && !isLegacyAllPlantelesCampaign(current) && getCampaignPlanteles(current).length === 0) {
    throw new Error("Selecciona al menos un plantel.");
  }

  return payload;
}
