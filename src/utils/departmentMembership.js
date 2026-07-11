function normalizeLegacyDepartmentLabel(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeDepartmentId(value, options = {}) {
  const { labelFallback = false } = options;

  if (value === null || value === undefined) return null;

  if (typeof value === "string" || typeof value === "number") {
    const cleanValue = String(value).trim();
    if (!cleanValue) return null;
    return labelFallback ? normalizeLegacyDepartmentLabel(cleanValue) || cleanValue : cleanValue;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeDepartmentId(item, options);
      if (normalized) return normalized;
    }
    return null;
  }

  const explicitId = normalizeDepartmentId(
    value.departmentId || value.primaryDepartmentId || value.areaId || value.id || value.value || value.key,
    { labelFallback: false }
  );
  if (explicitId) return explicitId;

  return normalizeDepartmentId(
    value.department || value.area || value.departmentName || value.name || value.title || value.team,
    { labelFallback: true }
  );
}

export function getUserDepartmentIds(user = {}) {
  const explicitIds = [
    user.departmentId,
    user.primaryDepartmentId,
    user.areaId,
    ...(Array.isArray(user.departmentIds) ? user.departmentIds : []),
  ];
  const legacyLabels = [
    user.department,
    user.area,
    user.departmentName,
    user.team,
    ...(Array.isArray(user.departmentNames) ? user.departmentNames : []),
    ...(Array.isArray(user.departments) ? user.departments : []),
  ];

  return [
    ...explicitIds.map((value) => normalizeDepartmentId(value)),
    ...legacyLabels.map((value) => normalizeDepartmentId(value, { labelFallback: true })),
  ]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

export function userBelongsToDepartmentId(user, departmentId) {
  const normalizedDepartmentId = normalizeDepartmentId(departmentId);
  const legacyDepartmentId = normalizeDepartmentId(departmentId, { labelFallback: true });
  const candidateIds = [normalizedDepartmentId, legacyDepartmentId].filter(Boolean);
  const userDepartmentIds = getUserDepartmentIds(user);
  return candidateIds.some((candidateId) => userDepartmentIds.includes(candidateId));
}

export function normalizeRole(role = "") {
  return String(role || "").trim().toLowerCase();
}

export function isActiveProfile(user = {}) {
  return user?.active !== false;
}

export function isAdminProfile(user = {}) {
  return isActiveProfile(user) && normalizeRole(user?.role) === "admin";
}

export function canAccessDepartment(user, departmentId) {
  if (!isActiveProfile(user)) return false;
  if (isAdminProfile(user)) return true;
  return userBelongsToDepartmentId(user, departmentId);
}
