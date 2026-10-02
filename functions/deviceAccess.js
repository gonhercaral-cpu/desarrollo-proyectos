// Classroom device identities are reserved for the publication API (drive codebase).
function guardClassroomDevices(handler, HttpsError) {
  return (request) => {
    if (request.auth?.token?.activeClassroomDevice === true || request.auth?.uid?.startsWith("ac-device-")) {
      throw new HttpsError("permission-denied", "Los equipos solo pueden consultar publicaciones de Active Classroom.");
    }
    return handler(request);
  };
}
module.exports = { guardClassroomDevices };
