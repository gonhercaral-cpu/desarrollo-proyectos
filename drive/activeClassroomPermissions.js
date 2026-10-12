const { HttpsError } = require("firebase-functions/v2/https");
const permissions = require("./activeClassroomPermissions.json");
function canClassroom(profile, action = "access") {
  return profile?.active === true && (profile.role === "admin" ||
    (profile.activeClassroomPermissions?.access === true && profile.activeClassroomPermissions?.[action] === true));
}
function requireClassroom(profile, action = "access") {
  if (!canClassroom(profile, action)) throw new HttpsError("permission-denied", "No tienes permiso para esta operación de Active Classroom.");
  return profile;
}
function createPermissionHandlers({ db, getProfile, timestamp }) {
  async function authorize(request) {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    return requireClassroom(await getProfile(request.auth.uid), "managePermissions");
  }
  return {
    async list(request) {
      await authorize(request);
      const [users, grants] = await Promise.all([db.collection("users").get(), db.collection("activeClassroomPermissions").get()]);
      const map = new Map(grants.docs.map(doc => [doc.id, doc.data().permissions || {}]));
      return { collaborators: users.docs.filter(doc => !doc.id.startsWith("ac-device-")).map(doc => {
        const user = doc.data();
        return { uid: doc.id, name: user.name || user.email || "Colaborador", email: user.email || "", role: user.role || "collaborator", active: user.active === true, permissions: Object.fromEntries(Object.keys(permissions).map(key => [key, user.role === "admin" || map.get(doc.id)?.[key] === true])) };
      }) };
    },
    async save(request) {
      await authorize(request);
      const { uid, permissions: incoming } = request.data || {};
      if (typeof uid !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid) || uid.startsWith("ac-device-") || !incoming || Array.isArray(incoming) || Object.keys(incoming).some(key => !Object.hasOwn(permissions, key) || typeof incoming[key] !== "boolean")) throw new HttpsError("invalid-argument", "Permisos inválidos.");
      const user = await db.collection("users").doc(uid).get();
      if (!user.exists) throw new HttpsError("not-found", "Colaborador no encontrado.");
      if (user.data().role === "admin") throw new HttpsError("failed-precondition", "Los administradores conservan acceso completo.");
      const values = Object.fromEntries(Object.keys(permissions).map(key => [key, incoming[key] === true]));
      await db.collection("activeClassroomPermissions").doc(uid).set({ schemaVersion: 1, permissions: values, updatedAt: timestamp(), updatedByUid: request.auth.uid });
      return { uid, permissions: values };
    },
  };
}
module.exports = { permissions, canClassroom, requireClassroom, createPermissionHandlers };
