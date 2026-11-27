"use strict";

const { createPrintProductionHandlers } = require("../functions/printProduction");

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Firestore en memoria: lecturas antes que escrituras, commit atómico y fallo de commit simulable.
function createFakeDb() {
  const store = new Map();
  let autoId = 0;
  let stamp = 0;
  const FieldValue = { serverTimestamp: () => ({ __serverTimestamp: ++stamp }) };

  function snapshot(path) {
    const exists = store.has(path);
    return {
      id: path.split("/").pop(),
      exists,
      ref: docRef(path),
      data: () => (exists ? structuredClone(store.get(path)) : undefined),
    };
  }

  function querySnapshot(path, filters) {
    const prefix = `${path}/`;
    const docs = [...store.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
      .filter((key) => filters.every(([field, , value]) => store.get(key)[field] === value))
      .sort()
      .map(snapshot);
    return { docs, size: docs.length, empty: docs.length === 0 };
  }

  function docRef(path) {
    return {
      __doc: true,
      id: path.split("/").pop(),
      path,
      collection: (name) => collectionRef(`${path}/${name}`),
      get: async () => snapshot(path),
    };
  }

  function collectionRef(path, filters = []) {
    return {
      __query: true,
      path,
      filters,
      doc: (id) => docRef(`${path}/${id || `auto${++autoId}`}`),
      where: (field, op, value) => collectionRef(path, [...filters, [field, op, value]]),
      get: async () => querySnapshot(path, filters),
    };
  }

  // Firestore real rechaza `undefined`; aquí también para detectarlo en las pruebas.
  function assertDefined(value, where) {
    if (value === undefined) throw new Error(`Valor undefined en ${where}`);
    if (value && typeof value === "object" && !(value instanceof Date)) {
      for (const [key, child] of Object.entries(value)) assertDefined(child, `${where}.${key}`);
    }
  }

  const db = {
    failNextCommit: false,
    collection: (name) => collectionRef(name),
    async runTransaction(callback) {
      const writes = [];
      let wrote = false;
      const tx = {
        get: async (ref) => {
          if (wrote) throw new Error("Las lecturas deben ir antes de las escrituras.");
          return ref.__doc ? snapshot(ref.path) : querySnapshot(ref.path, ref.filters);
        },
        set(ref, data, options) {
          assertDefined(data, ref.path);
          wrote = true;
          writes.push({ op: "set", path: ref.path, data, merge: options?.merge === true });
          return tx;
        },
        create(ref, data) {
          assertDefined(data, ref.path);
          wrote = true;
          writes.push({ op: "create", path: ref.path, data });
          return tx;
        },
        update(ref, data) {
          assertDefined(data, ref.path);
          wrote = true;
          writes.push({ op: "update", path: ref.path, data });
          return tx;
        },
      };
      const result = await callback(tx);
      if (db.failNextCommit) {
        db.failNextCommit = false;
        throw new Error("commit-failed");
      }
      const next = new Map(store);
      for (const write of writes) {
        const exists = next.has(write.path);
        if (write.op === "create" && exists) throw new Error(`already-exists: ${write.path}`);
        if (write.op === "update" && !exists) throw new Error(`not-found: ${write.path}`);
        const data = structuredClone(write.data);
        if (write.op === "create" || (write.op === "set" && !write.merge)) next.set(write.path, data);
        else next.set(write.path, { ...(next.get(write.path) || {}), ...data });
      }
      store.clear();
      for (const [key, value] of next) store.set(key, value);
      return result;
    },
    seed(path, data) {
      store.set(path, structuredClone(data));
    },
    patch(path, data) {
      store.set(path, { ...store.get(path), ...structuredClone(data) });
    },
    read: (path) => (store.has(path) ? structuredClone(store.get(path)) : undefined),
    list: (path) => querySnapshot(path, []).docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    paths: () => [...store.keys()].sort(),
  };
  return { db, FieldValue };
}

const actors = {
  admin: { uid: "admin1", name: "Admin", email: "admin@test.local", isAdmin: true, canAccessPrintshop: true },
  operator: { uid: "op1", name: "Operador", email: "op@test.local", isAdmin: false, canAccessPrintshop: true },
  operator2: { uid: "op2", name: "Operadora", email: "op2@test.local", isAdmin: false, canAccessPrintshop: true },
  outsider: { uid: "out1", name: "Docente", email: "out@test.local", isAdmin: false, canAccessPrintshop: false },
};

function createHarness() {
  const { db, FieldValue } = createFakeDb();
  const handlers = createPrintProductionHandlers({
    db,
    FieldValue,
    HttpsError: FakeHttpsError,
    getActor: async (request) => request.actor,
    assertAdmin: (actor) => {
      if (!actor.isAdmin) throw new FakeHttpsError("permission-denied", "Solo un administrador.");
    },
    now: () => NOW,
  });
  const harness = {
    db,
    ...handlers,
    save: (actor, data) => handlers.save({ actor, data }),
    action: (actor, data) => handlers.action({ actor, data }),
    settings: (actor, data) => handlers.settings({ actor, data }),
  };
  seedBase(db);
  return harness;
}

function seedPrinter(db, id, overrides = {}) {
  db.seed(`printPrinters/${id}`, {
    agentId: `agent-${id}`,
    name: `Impresora ${id}`,
    queue: `queue-${id}`,
    online: true,
    color: true,
    duplex: true,
    paperSizes: ["Letter", "Legal"],
    lastSeenAt: new Date(NOW - 10 * 1000),
    capabilities: { pagesPerMinute: 40, pageRange: true },
    ...overrides,
  });
}

function seedSource(db, id, overrides = {}) {
  db.seed(`printDocuments/${id}`, {
    id,
    ownerUid: actors.operator.uid,
    path: `print-documents/op1/${id}.pdf`,
    sha256: "a".repeat(64),
    pages: 60,
    name: "Manual.pdf",
    size: 2048,
    origin: "upload",
    ...overrides,
  });
}

function seedBase(db) {
  seedPrinter(db, "p-a");
  seedPrinter(db, "p-b", { capabilities: { pagesPerMinute: 20, pageRange: true } });
  seedSource(db, "doc-1");
}

let counter = 0;
const nextRequestId = (prefix = "req") => `${prefix}-${String(++counter).padStart(6, "0")}`;

function savePayload(overrides = {}) {
  return {
    requestId: nextRequestId("save"),
    sourceId: "doc-1",
    title: "Manual de práctica",
    type: "document",
    config: { copies: 1, paper: "Letter", color: false, duplex: false },
    mode: "single",
    printerIds: ["p-a"],
    draft: false,
    ...overrides,
  };
}

module.exports = {
  FakeHttpsError,
  NOW,
  actors,
  createFakeDb,
  createHarness,
  nextRequestId,
  savePayload,
  seedPrinter,
  seedSource,
};
