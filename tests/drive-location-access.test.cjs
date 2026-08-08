const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateResolvedAccess,
  hasDepartmentLocationGrant,
  hasNonShareLocationGrant,
  isPrivateRootMetadata,
  resolveFolderAccess,
} = require("../drive/accessControl");

function createDrive(parentsById) {
  return {
    files: {
      async get({ fileId }) {
        if (!Object.hasOwn(parentsById, fileId)) {
          const error = new Error("File not found");
          error.code = 404;
          throw error;
        }
        return { data: { id: fileId, parents: parentsById[fileId] } };
      },
    },
  };
}

function metadataReader(metadataById) {
  return async (fileId) => metadataById[fileId] || {};
}

async function resolve({ parents, metadata, itemId, allowedRoots }) {
  return resolveFolderAccess({
    drive: createDrive(parents),
    folderId: itemId,
    allowedRootIds: allowedRoots,
    getPrivateMetadata: metadataReader(metadata),
  });
}

test("solo la raiz real de Mi unidad define privacidad", () => {
  assert.equal(isPrivateRootMetadata({ ownerUid: "manuel", visibility: "private" }), false);
  assert.equal(
    isPrivateRootMetadata({ ownerUid: "manuel", visibility: "private", isRoot: true }),
    true
  );
});

test("carpeta creada directamente en Produccion Audiovisual permite listar e importar", async () => {
  const access = await resolve({
    parents: {
      video: ["carpeta-produccion"],
      "carpeta-produccion": ["produccion-audiovisual"],
      "produccion-audiovisual": ["nube-aes"],
      "nube-aes": [],
    },
    metadata: {},
    itemId: "video",
    allowedRoots: ["produccion-audiovisual"],
  });
  const departmentGrant = hasDepartmentLocationGrant(access, ["produccion-audiovisual"]);

  assert.equal(departmentGrant, true);
  assert.deepEqual(
    evaluateResolvedAccess({
      access,
      uid: "usuario-produccion",
      requireWrite: false,
      hasDepartmentLocationGrant: departmentGrant,
    }),
    { allowed: true, reason: "allowed" }
  );
});

test("Videos Digital Signage movida a Produccion Audiovisual hereda acceso departamental", async () => {
  const parents = {
    "video-1": ["subcarpeta"],
    "video-2": ["videos-digital-signage"],
    subcarpeta: ["videos-digital-signage"],
    "videos-digital-signage": ["produccion-audiovisual"],
    "produccion-audiovisual": ["nube-aes"],
    "nube-aes": [],
  };
  const metadata = {
    "videos-digital-signage": {
      ownerUid: "manuel",
      ownerName: "Manuel",
      visibility: "private",
    },
    subcarpeta: {
      ownerUid: "manuel",
      ownerName: "Manuel",
      visibility: "private",
    },
  };

  for (const itemId of ["videos-digital-signage", "subcarpeta", "video-1", "video-2"]) {
    const access = await resolve({
      parents,
      metadata,
      itemId,
      allowedRoots: ["produccion-audiovisual"],
    });

    assert.deepEqual(
      evaluateResolvedAccess({ access, uid: "usuario-produccion", requireWrite: false }),
      { allowed: true, reason: "allowed" },
      `${itemId} debe permitir listar, abrir, reproducir y descargar`
    );
    assert.equal(access.privacyRootId, null, `${itemId} no debe conservar privacidad historica`);
  }
});

test("rama departamental actual prevalece sobre padre privado historico aun presente", async () => {
  const access = await resolve({
    parents: {
      video: ["videos-digital-signage"],
      "videos-digital-signage": ["produccion-audiovisual", "mi-unidad-manuel"],
      "produccion-audiovisual": ["nube-aes"],
      "mi-unidad-manuel": ["usuarios"],
      usuarios: ["nube-aes"],
      "nube-aes": [],
    },
    metadata: {
      "videos-digital-signage": { ownerUid: "emanuel", visibility: "private" },
      "mi-unidad-manuel": {
        ownerUid: "emanuel",
        visibility: "private",
        isRoot: true,
      },
    },
    itemId: "video",
    allowedRoots: ["produccion-audiovisual", "nube-aes"],
  });
  const departmentGrant = hasDepartmentLocationGrant(access, ["produccion-audiovisual"]);

  assert.equal(access.privacyRootId, "mi-unidad-manuel");
  assert.equal(departmentGrant, true);
  assert.deepEqual(
    evaluateResolvedAccess({
      access,
      uid: "administrador",
      requireWrite: false,
      hasDepartmentLocationGrant: departmentGrant,
    }),
    { allowed: true, reason: "allowed" }
  );
});

test("usuario sin acceso a Produccion Audiovisual sigue bloqueado", async () => {
  const access = await resolve({
    parents: {
      video: ["videos-digital-signage"],
      "videos-digital-signage": ["produccion-audiovisual"],
      "produccion-audiovisual": ["nube-aes"],
      "nube-aes": [],
    },
    metadata: {
      "videos-digital-signage": { ownerUid: "manuel", visibility: "private" },
    },
    itemId: "video",
    allowedRoots: ["otro-departamento"],
  });

  assert.deepEqual(
    evaluateResolvedAccess({ access, uid: "usuario-sin-acceso", requireWrite: false }),
    { allowed: false, reason: "outside-allowed-root" }
  );
});

test("acceso departamental prevalece sobre un share viewer historico", async () => {
  const access = await resolve({
    parents: {
      video: ["videos-digital-signage"],
      "videos-digital-signage": ["produccion-audiovisual"],
      "produccion-audiovisual": ["nube-aes"],
      "nube-aes": [],
    },
    metadata: {
      "videos-digital-signage": { ownerUid: "manuel", visibility: "private" },
    },
    itemId: "video",
    allowedRoots: ["videos-digital-signage", "produccion-audiovisual"],
  });

  assert.deepEqual(access.matchedRootIds, ["videos-digital-signage", "produccion-audiovisual"]);
  assert.equal(hasNonShareLocationGrant(access, ["produccion-audiovisual"]), true);
  assert.deepEqual(
    evaluateResolvedAccess({ access, uid: "usuario-produccion", shareRole: null, requireWrite: true }),
    { allowed: true, reason: "allowed" }
  );
});

test("elemento dentro de Mi unidad conserva privacidad incluso para administrador", async () => {
  const access = await resolve({
    parents: {
      video: ["carpeta-privada"],
      "carpeta-privada": ["mi-unidad-manuel"],
      "mi-unidad-manuel": ["usuarios"],
      usuarios: ["nube-aes"],
      "nube-aes": [],
    },
    metadata: {
      "carpeta-privada": { ownerUid: "manuel", visibility: "private" },
      "mi-unidad-manuel": {
        ownerUid: "manuel",
        visibility: "private",
        isRoot: true,
      },
    },
    itemId: "video",
    allowedRoots: ["nube-aes"],
  });

  assert.deepEqual(
    evaluateResolvedAccess({ access, uid: "administrador", requireWrite: false }),
    { allowed: false, reason: "private" }
  );
  assert.deepEqual(
    evaluateResolvedAccess({ access, uid: "manuel", requireWrite: true }),
    { allowed: true, reason: "allowed" }
  );
});

test("mover nuevamente a Mi unidad restaura permisos privados por ubicacion", async () => {
  const access = await resolve({
    parents: {
      "videos-digital-signage": ["mi-unidad-manuel"],
      "mi-unidad-manuel": ["usuarios"],
      usuarios: ["nube-aes"],
      "nube-aes": [],
    },
    metadata: {
      "videos-digital-signage": { visibility: "inherited", createdByUid: "manuel" },
      "mi-unidad-manuel": {
        ownerUid: "manuel",
        visibility: "private",
        isRoot: true,
      },
    },
    itemId: "videos-digital-signage",
    allowedRoots: ["nube-aes"],
  });

  assert.deepEqual(
    evaluateResolvedAccess({ access, uid: "usuario-produccion", requireWrite: false }),
    { allowed: false, reason: "private" }
  );
});

test("compartido privado conserva rol viewer aunque raiz compartida se encuentre primero", async () => {
  const access = await resolve({
    parents: {
      video: ["carpeta-compartida"],
      "carpeta-compartida": ["mi-unidad-manuel"],
      "mi-unidad-manuel": ["usuarios"],
      usuarios: ["nube-aes"],
      "nube-aes": [],
    },
    metadata: {
      "carpeta-compartida": { ownerUid: "manuel", visibility: "private" },
      "mi-unidad-manuel": {
        ownerUid: "manuel",
        visibility: "private",
        isRoot: true,
      },
    },
    itemId: "video",
    allowedRoots: ["carpeta-compartida"],
  });

  assert.equal(access.matchedRootId, "carpeta-compartida");
  assert.equal(access.privacyRootId, "mi-unidad-manuel");
  assert.deepEqual(
    evaluateResolvedAccess({ access, uid: "invitado", shareRole: "viewer", requireWrite: false }),
    { allowed: true, reason: "allowed" }
  );
  assert.deepEqual(
    evaluateResolvedAccess({ access, uid: "invitado", shareRole: "viewer", requireWrite: true }),
    { allowed: false, reason: "read-only-share" }
  );
});
