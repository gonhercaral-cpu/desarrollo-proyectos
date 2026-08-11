"use strict";

const PROJECT_ID = "sistema-desarrollo-proyectos";
const AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

// Este script es exclusivamente local. Fijar ambos hosts antes de cargar Admin
// evita que una ejecución accidental pueda escribir en Firebase de producción.
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT_ID });
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;

const { deleteApp, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const LOCAL_ADMIN = {
  uid: "local-admin",
  email: "admin.local@active.edu.mx",
  password: "LocalAdmin123!",
  displayName: "Administrador local",
};

async function upsertAuthUser(auth) {
  try {
    await auth.getUser(LOCAL_ADMIN.uid);
    return auth.updateUser(LOCAL_ADMIN.uid, {
      email: LOCAL_ADMIN.email,
      password: LOCAL_ADMIN.password,
      displayName: LOCAL_ADMIN.displayName,
      disabled: false,
      emailVerified: true,
    });
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw error;
    }

    return auth.createUser({
      uid: LOCAL_ADMIN.uid,
      email: LOCAL_ADMIN.email,
      password: LOCAL_ADMIN.password,
      displayName: LOCAL_ADMIN.displayName,
      disabled: false,
      emailVerified: true,
    });
  }
}

async function seed() {
  const app = initializeApp({ projectId: PROJECT_ID });

  try {
    await upsertAuthUser(getAuth(app));

    const userRef = getFirestore(app).collection("users").doc(LOCAL_ADMIN.uid);
    const snapshot = await userRef.get();
    const now = FieldValue.serverTimestamp();

    await userRef.set({
      name: LOCAL_ADMIN.displayName,
      email: LOCAL_ADMIN.email,
      area: "Dirección",
      role: "admin",
      privilege: "admin",
      active: true,
      deleted: false,
      notes: "Usuario exclusivo de emuladores locales",
      updatedAt: now,
      updatedByUid: LOCAL_ADMIN.uid,
      updatedByName: LOCAL_ADMIN.displayName,
      updatedByEmail: LOCAL_ADMIN.email,
      ...(!snapshot.exists ? {
        createdAt: now,
        createdByUid: LOCAL_ADMIN.uid,
        createdByName: LOCAL_ADMIN.displayName,
        createdByEmail: LOCAL_ADMIN.email,
      } : {}),
    }, { merge: true });

    console.log("Emuladores sembrados correctamente.");
    console.log(`Correo: ${LOCAL_ADMIN.email}`);
    console.log(`Contraseña: ${LOCAL_ADMIN.password}`);
    console.log(`UID: ${LOCAL_ADMIN.uid}`);
  } finally {
    await deleteApp(app);
  }
}

seed().catch((error) => {
  console.error("No se pudieron sembrar los emuladores:", error);
  process.exitCode = 1;
});
