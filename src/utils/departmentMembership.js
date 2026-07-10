export function getUserDepartmentIds(user = {}) {
  return [user.departmentId, user.primaryDepartmentId, user.areaId, ...(Array.isArray(user.departmentIds) ? user.departmentIds : [])]
    .filter(Boolean)
    .map(String);
}

export function userBelongsToDepartmentId(user, departmentId) {
  return Boolean(departmentId) && getUserDepartmentIds(user).includes(String(departmentId));
}
