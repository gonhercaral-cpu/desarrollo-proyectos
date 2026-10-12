import labels from "../../../drive/activeClassroomPermissions.json" with { type: "json" };
export const CLASSROOM_PERMISSIONS = labels;
export function canClassroom(profile, action = "access") {
  return profile?.active === true && (profile.role === "admin" || (profile.activeClassroomPermissions?.access === true && profile.activeClassroomPermissions?.[action] === true));
}
export function assertClassroom(profile, action = "access") {
  if (!profile?.uid || !canClassroom(profile, action)) throw new Error("No tienes permiso para esta operación de Active Classroom.");
}
