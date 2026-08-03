const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  collectPrintRequestRecipients,
  collectProjectRecipients,
  createDeduplicatedNotifications,
} = require("../functions/operationalNotifications");
const {
  createSupportTool,
  getSupportToolActor,
  loanSupportTool,
} = require("../functions/supportTools");

const fieldValue = { serverTimestamp: () => "SERVER_TIMESTAMP" };

class Snapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value !== undefined;
    this._value = value;
  }

  data() {
    return this._value;
  }
}

class Ref {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new CollectionRef(this.db, `${this.path}/${name}`);
  }

  async get() {
    return new Snapshot(this, this.db.records.get(this.path));
  }

  async set(value) {
    this.db.records.set(this.path, value);
  }
}

class CollectionRef {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  doc(id = "") {
    const resolvedId = id || `auto-${++this.db.autoId}`;
    return new Ref(this.db, `${this.path}/${resolvedId}`);
  }
}

class FakeDatabase {
  constructor(seed = {}) {
    this.records = new Map(Object.entries(seed));
    this.autoId = 0;
  }

  collection(name) {
    return new CollectionRef(this, name);
  }

  async runTransaction(work) {
    const transaction = {
      get: async (ref) => new Snapshot(ref, this.records.get(ref.path)),
      create: (ref, value) => {
        if (this.records.has(ref.path)) throw new Error("already-exists");
        this.records.set(ref.path, value);
      },
      set: (ref, value, options = {}) => {
        const current = this.records.get(ref.path) || {};
        this.records.set(ref.path, options.merge ? { ...current, ...value } : value);
      },
      update: (ref, value) => {
        if (!this.records.has(ref.path)) throw new Error("not-found");
        this.records.set(ref.path, { ...this.records.get(ref.path), ...value });
      },
    };
    return work(transaction);
  }
}

describe("notificaciones operativas", () => {
  it("reune destinatarios sin duplicados", () => {
    assert.deepEqual(
      [...collectProjectRecipients({ assignedToUid: "u1", collaboratorIds: ["u1", "u2"] })].sort(),
      ["u1", "u2"]
    );
    assert.deepEqual(
      [...collectPrintRequestRecipients({ responsibleUid: "u1", supportUserIds: ["u2", "u2"] })].sort(),
      ["u1", "u2"]
    );
  });

  it("deduplica por evento y destinatario y excluye al actor", async () => {
    const db = new FakeDatabase();
    const event = {
      type: "project_updated",
      module: "projects",
      title: "Cambio",
      message: "Proyecto actualizado",
      entityType: "project",
      entityId: "p1",
      entityName: "Proyecto uno",
      route: "/?projectId=p1",
      actor: { uid: "actor", name: "Actor" },
      priority: "normal",
      deduplicationKey: "project:p1:update:1",
    };
    assert.equal(await createDeduplicatedNotifications(db, fieldValue, event, new Set(["actor", "u1"])), 1);
    assert.equal(await createDeduplicatedNotifications(db, fieldValue, event, new Set(["actor", "u1"])), 0);
    assert.equal([...db.records.keys()].filter((key) => key.startsWith("notifications/")).length, 1);
  });
});

describe("inventario de herramientas", () => {
  const actor = { uid: "tech", name: "Tecnico", email: "tech@test.local", isAdmin: false };

  it("genera folios consecutivos mediante contador transaccional", async () => {
    const db = new FakeDatabase();
    const first = await createSupportTool(db, { name: "Taladro", category: "Electrica" }, actor, fieldValue);
    const second = await createSupportTool(db, { name: "Pinza", category: "Manual" }, actor, fieldValue);
    assert.equal(first.folio, "HER-000001");
    assert.equal(second.folio, "HER-000002");
    assert.equal(db.records.get("supportCounters/tools").value, 2);
  });

  it("bloquea doble prestamo y conserva movimiento/historial", async () => {
    const db = new FakeDatabase();
    const tool = await createSupportTool(db, { name: "Taladro", category: "Electrica" }, actor, fieldValue);
    const loan = await loanSupportTool(db, tool.id, {
      recipientUid: "employee-1",
      recipientName: "Empleado Uno",
      reason: "Instalacion",
    }, actor, fieldValue);
    assert.equal(loan.status, "Prestada");
    await assert.rejects(
      loanSupportTool(db, tool.id, { recipientUid: "employee-2", recipientName: "Empleado Dos" }, actor, fieldValue),
      /no disponible/i
    );
    const toolData = db.records.get(`supportTools/${tool.id}`);
    assert.equal(toolData.responsibleUid, "employee-1");
    assert.ok(toolData.activeMovementId);
  });

  it("rechaza usuario fuera de Soporte", async () => {
    const db = new FakeDatabase({
      "users/requester": { active: true, role: "collaborator", area: "Academico" },
    });
    await assert.rejects(getSupportToolActor(db, "requester"), /no tiene acceso/i);
  });
});
