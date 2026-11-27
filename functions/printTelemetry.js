"use strict";

const integer = (value, max) => Number.isInteger(value) && value >= 0 && value <= max ? value : null;
const label = (value) => typeof value === "string" ? value.trim().replace(/\p{Cc}/gu, "").slice(0, 100) : "";

function metrics(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 32).flatMap((item) => {
    const name = label(item?.name);
    if (!name) return [];
    const level = integer(item.level, 100000000);
    const capacity = integer(item.capacity, 100000000);
    return [{ name, level, capacity: capacity > 0 ? capacity : null, unit: label(item.unit) }];
  });
}

function printerTelemetry(input) {
  const data = input && typeof input === "object" ? input : {};
  return {
    state: ["idle", "processing", "stopped"].includes(data.state) ? data.state : null,
    accepting: typeof data.accepting === "boolean" ? data.accepting : null,
    queuedJobs: integer(data.queuedJobs, 10000),
    makeModel: label(data.makeModel),
    location: label(data.location),
    speed: integer(data.speed, 2000),
    colorSpeed: integer(data.colorSpeed, 2000),
    supplies: metrics(data.supplies),
    trays: metrics(data.trays),
  };
}

function progress(input) {
  const impressions = integer(input?.impressions, 10000000);
  const completed = integer(input?.completed, 10000000);
  return completed == null || (impressions != null && completed > impressions) ? null : { impressions, completed };
}

module.exports = { printerTelemetry, progress };
