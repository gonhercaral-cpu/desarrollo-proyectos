const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();

const ALLOWED_ROLES = ["admin", "collaborator", "requester"];

async function assertAdmin(request) {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Debes iniciar sesión para realizar esta acción."
    );
  }

  const requesterUid = request.auth.uid;
  const requesterSnapshot = await db.collection("users").doc(requesterUid).get();

  if (!requesterSnapshot.exists) {
    throw new HttpsError(
      "permission-denied",
      "Tu usuario no tiene perfil administrativo."
    );
  }

  const requesterProfile = requesterSnapshot.data();

  if (requesterProfile.active !== true || requesterProfile.role !== "admin") {
    throw new HttpsError(
      "permission-denied",
      "Solo un administrador puede realizar esta acción."
    );
  }

  return {
    uid: requesterUid,
    ...requesterProfile,
  };
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createTemporaryPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "@#$%&*";
  const all = upper + lower + numbers + symbols;

  function pick(source) {
    return source[Math.floor(Math.random() * source.length)];
  }

  let password =
    pick(upper) + pick(lower) + pick(numbers) + pick(symbols);

  for (let index = 0; index < 8; index += 1) {
    password += pick(all);
  }

  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

exports.createUserByAdmin = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const adminProfile = await assertAdmin(request);

    const data = request.data || {};

    const name = cleanString(data.name);
    const email = cleanString(data.email).toLowerCase();
    const area = cleanString(data.area);
    const role = cleanString(data.role) || "collaborator";
    const notes = cleanString(data.notes);
    const active = data.active !== false;
    const temporaryPassword =
      cleanString(data.temporaryPassword) || createTemporaryPassword();

    if (!name) {
      throw new HttpsError(
        "invalid-argument",
        "El nombre del usuario es obligatorio."
      );
    }

    if (!email || !email.includes("@")) {
      throw new HttpsError(
        "invalid-argument",
        "El correo electrónico no es válido."
      );
    }

    if (!ALLOWED_ROLES.includes(role)) {
      throw new HttpsError(
        "invalid-argument",
        "El privilegio seleccionado no es válido."
      );
    }

    if (temporaryPassword.length < 8) {
      throw new HttpsError(
        "invalid-argument",
        "La contraseña temporal debe tener al menos 8 caracteres."
      );
    }

    let createdAuthUser = null;

    try {
      createdAuthUser = await getAuth().createUser({
        email,
        password: temporaryPassword,
        displayName: name,
        disabled: !active,
        emailVerified: false,
      });

      const userDocRef = db.collection("users").doc(createdAuthUser.uid);

      await userDocRef.set({
        name,
        email,
        area,
        role,
        privilege: role,
        active,
        deleted: false,
        notes,
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: adminProfile.uid,
        createdByName: adminProfile.name || "",
        createdByEmail: adminProfile.email || "",
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: adminProfile.uid,
        updatedByName: adminProfile.name || "",
        updatedByEmail: adminProfile.email || "",
      });

      return {
        ok: true,
        uid: createdAuthUser.uid,
        email,
        temporaryPassword,
        message: "Usuario creado correctamente.",
      };
    } catch (error) {
      if (createdAuthUser?.uid) {
        try {
          await getAuth().deleteUser(createdAuthUser.uid);
        } catch (rollbackError) {
          console.error("No se pudo revertir el usuario creado:", rollbackError);
        }
      }

      console.error("Error creando usuario:", error);

      if (error.code === "auth/email-already-exists") {
        throw new HttpsError(
          "already-exists",
          "Ya existe un usuario con ese correo electrónico."
        );
      }

      throw new HttpsError(
        "internal",
        error.message || "No se pudo crear el usuario."
      );
    }
  }
);

exports.updateUserByAdmin = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const adminProfile = await assertAdmin(request);
    const data = request.data || {};

    const uid = cleanString(data.uid);
    const name = cleanString(data.name);
    const email = cleanString(data.email).toLowerCase();
    const area = cleanString(data.area);
    const role = cleanString(data.role) || "collaborator";
    const privilege = cleanString(data.privilege) || role;
    const notes = cleanString(data.notes);
    const active = data.active !== false;
    const department = cleanString(data.department);
    const departmentName = cleanString(data.departmentName);
    const primaryDepartmentId = cleanString(data.primaryDepartmentId);
    const departmentIds = Array.isArray(data.departmentIds)
      ? data.departmentIds.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [];
    const departmentNames = Array.isArray(data.departmentNames)
      ? data.departmentNames.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [];

    if (!uid) {
      throw new HttpsError(
        "invalid-argument",
        "Falta el ID del usuario."
      );
    }

    if (!name) {
      throw new HttpsError(
        "invalid-argument",
        "El nombre del usuario es obligatorio."
      );
    }

    if (!email || !email.includes("@")) {
      throw new HttpsError(
        "invalid-argument",
        "El correo electrÃ³nico no es vÃ¡lido."
      );
    }

    if (!ALLOWED_ROLES.includes(role) || !ALLOWED_ROLES.includes(privilege)) {
      throw new HttpsError(
        "invalid-argument",
        "El privilegio seleccionado no es vÃ¡lido."
      );
    }

    try {
      await getAuth().updateUser(uid, {
        email,
        displayName: name,
        disabled: !active,
      });

      await db.collection("users").doc(uid).update({
        name,
        email,
        area,
        department,
        departmentName,
        departmentIds,
        departmentNames,
        primaryDepartmentId,
        role,
        privilege,
        active,
        notes,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: adminProfile.uid,
        updatedByName: adminProfile.name || "",
        updatedByEmail: adminProfile.email || "",
      });

      return {
        ok: true,
        uid,
        email,
        message: "Usuario actualizado correctamente.",
      };
    } catch (error) {
      console.error("Error actualizando usuario:", error);

      if (error.code === "auth/email-already-exists") {
        throw new HttpsError(
          "already-exists",
          "Ya existe un usuario con ese correo electrÃ³nico."
        );
      }

      if (error.code === "auth/user-not-found") {
        throw new HttpsError(
          "not-found",
          "No existe este usuario en Firebase Authentication."
        );
      }

      throw new HttpsError(
        "internal",
        error.message || "No se pudo actualizar el usuario."
      );
    }
  }
);
