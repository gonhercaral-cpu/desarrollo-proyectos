const { randomUUID } = require("node:crypto");
const { DEFAULT_CONFIG, validateConfig, evaluateProject, metricsFor, hash, normalize, calendarDay } = require("./projectSupervisionEngine");
const { buildNotificationDocument, deduplicationDocumentId } = require("./operationalNotifications");
const { analysisKey, tokenReservation } = require("./projectSupervisionAI");

const PRIVATE = "projectSupervisionPrivate";
const SUMMARIES = "projectSupervisionSummaries";
const PAGE_SIZE = 25;
const SCAN_SIZE = 100;
const text = (value, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const iso = (value) => value?.toDate ? value.toDate().toISOString() : value || null;
const route = (id) => `/?page=project-detail&projectId=${encodeURIComponent(id)}`;

function createSupervisionHandlers({ db, FieldValue, HttpsError, provider = null, now = () => new Date(),
  automationApproved = false, aiApproved = false }) {
  const settingsRef = db.collection(PRIVATE).doc("settings");
  const statsRef = db.collection(PRIVATE).doc("stats");
  const summaries = db.collection(SUMMARIES);
  const ref = (kind, id) => db.collection(PRIVATE).doc(`${kind}-${id}`);
  const error = (code, message) => { throw new HttpsError(code, message); };
  const identifier = (value) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) error("invalid-argument", "Identificador inválido.");
    return value;
  };
  const keyFor = (kind, id) => hash([kind, id]);
  async function config() {
    const snap = await settingsRef.get();
    return validateConfig(snap.exists ? snap.data().config : DEFAULT_CONFIG);
  }
  async function admin(request) {
    if (!request.auth?.uid) error("unauthenticated", "Inicia sesión.");
    if (request.auth.uid.startsWith("ac-device-") || request.auth.token?.activeClassroomDevice) error("permission-denied", "Sesión de dispositivo no permitida.");
    const profile = await db.collection("users").doc(request.auth.uid).get();
    if (!profile.exists || profile.data().active !== true || profile.data().role !== "admin") error("permission-denied", "Solo dirección puede utilizar supervisión.");
    return { uid: request.auth.uid, name: text(profile.data().name, 120) || "Dirección" };
  }
  async function rateLimit(actor, op) {
    const stamp = now();
    const limitRef = ref("rate", keyFor(actor.uid, `${stamp.toISOString().slice(0, 16)}:${op}`));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(limitRef);
      const count = snap.data()?.count || 0;
      if (count >= (op === "analyze" ? 5 : 30)) error("resource-exhausted", "Demasiadas solicitudes. Espera un minuto.");
      tx.set(limitRef, { count: count + 1, expiresAt: new Date(stamp.getTime() + 86400000), cleanupAt: new Date(stamp.getTime() + 86400000) });
    });
  }
  async function related(project, tx = null) {
    const results = await Promise.all(["projectUpdates", "projectLogs", "evidence"].map((name) => {
      const query = db.collection(name).where("projectId", "==", project.id).orderBy("createdAt", "desc").limit(30);
      return tx ? tx.get(query) : query.get();
    }));
    const updates = results[0].docs.map((doc) => ({ ...doc.data(), id: `update-${doc.id}`, text: doc.data().comment || "" }))
      .filter((update) => update.text && !/^El administrador (editó|marcó|cambió)/i.test(update.text));
    const logs = results[1].docs.map((doc) => ({ ...doc.data(), id: `log-${doc.id}`, text: doc.data().description || "" }))
      .filter((log) => ["COMMENT_ADDED", "EVIDENCE_UPLOADED", "PROGRESS_CHANGED", "CHECKLIST_COMPLETED", "CHECKLIST_BLOCKED"].includes(log.type));
    let externalEvidenceCounts = null;
    if (results[2].size === 30) {
      const base = db.collection("evidence").where("projectId", "==", project.id);
      const read = (query) => tx ? tx.get(query) : query.get();
      const counts = await Promise.all([read(base.count()), read(base.where("reviewStatus", "in", ["approved", "aprobado", "aprobada", "accepted"]).count()),
        read(base.where("reviewStatus", "in", ["rejected", "rechazado", "rechazada"]).count())]);
      externalEvidenceCounts = { total: counts[0].data().count, approved: counts[1].data().count, rejected: counts[2].data().count };
      externalEvidenceCounts.pending = externalEvidenceCounts.total - externalEvidenceCounts.approved - externalEvidenceCounts.rejected;
    }
    return { ...project, externalEvidenceCounts, advances: [...(Array.isArray(project.advances) ? project.advances : []), ...updates, ...logs],
      externalEvidence: results[2].docs.map((doc) => ({ ...doc.data(), id: doc.id })),
      contextTruncated: results.some((snap) => snap.size === 30) };
  }
  async function getProject(id, tx = null) {
    const docRef = db.collection("projects").doc(identifier(id));
    const snap = tx ? await tx.get(docRef) : await docRef.get();
    if (!snap.exists) error("not-found", "Proyecto no encontrado.");
    return related({ ...snap.data(), id: snap.id }, tx);
  }
  async function projectContext(id) { return getProject(id); }
  function evaluate(project, cfg) {
    const summary = evaluateProject(project, cfg, now());
    summary.pendingDeliverables = [project.deliverables, project.activities, project.milestones].flatMap((items) => Array.isArray(items) ? items : [])
      .filter((item) => item?.completed !== true && !["completado", "completed", "finalizado", "terminado", "done", "entregado", "aprobado", "cancelado", "cancelled"].includes(normalize(item?.status))).length;
    const counts = project.externalEvidenceCounts;
    if (counts) {
      const embedded = [project.evidenceFiles, project.evidence, project.evidences, project.attachments,
        ...(Array.isArray(project.advances) ? project.advances.map((a) => a.files) : [])].some((items) => Array.isArray(items) && items.length);
      summary.readyForClosure = false; // No se recomienda cierre con contenido de evidencias fuera de la muestra.
      if (!embedded) {
        summary.pendingEvidence = summary.active ? counts.pending : 0;
        summary.reasons = summary.reasons.filter((r) => !["EVIDENCE_PENDING", "EVIDENCE_REJECTED"].includes(r.code));
        if (summary.active && counts.pending > 0) summary.reasons.push({ code: "EVIDENCE_PENDING", message: `${counts.pending} evidencias pendientes de revisión (conteo completo)`, source: `evidence-count:${project.id}` });
        if (summary.active && counts.rejected > 0) {
          summary.reasons.push({ code: "EVIDENCE_REJECTED", message: `${counts.rejected} evidencias rechazadas (conteo completo)`, source: `evidence-count:${project.id}` });
          if (summary.risk === "bajo") { summary.risk = "medio"; summary.riskScore = Math.max(40, summary.riskScore); }
        }
        summary.sources.push({ id: `evidence-count:${project.id}`, type: "evidence", text: `Conteo completo de metadatos: ${counts.total} evidencias; ${counts.pending} pendientes; ${counts.rejected} rechazadas. No se leyeron archivos.`, at: null, contentAnalyzed: false });
        summary.decisionPending = summary.active && (summary.decisionPending || counts.pending > 0 || counts.rejected > 0);
      } else {
        summary.evidenceCountPartial = true;
        summary.decisionPending = summary.active;
        summary.sources.push({ id: `evidence-scope:${project.id}`, type: "evidence", text: "Conteo parcial de evidencias: existen registros fuera de la muestra y estados embebidos autoritativos. No se puede asegurar que todas estén revisadas.", at: null, contentAnalyzed: false });
        summary.missingInformation.push("Evidencias heredadas y embebidas: el conteo conocido es un mínimo; revisar el proyecto completo antes de decidir.");
      }
    }
    summary.version = hash([summary.version, summary.pendingDeliverables, counts]);
    if (project.contextTruncated) summary.missingInformation.push("Contexto histórico limitado a 30 registros por colección. Los archivos no fueron leídos.");
    return summary;
  }
  async function recompute(id, givenConfig, force = false) {
    const cfg = givenConfig || await config();
    // La lectura transaccional actual evita que triggers desordenados publiquen una versión antigua.
    return db.runTransaction(async (tx) => {
      const projectSnap = await tx.get(db.collection("projects").doc(identifier(id)));
      const old = await tx.get(summaries.doc(id));
      const stats = await tx.get(statsRef);
      if (!projectSnap.exists && !old.exists) return null;
      const rawProject = { ...projectSnap.data(), id };
      let effectiveZone = cfg.timeZone;
      if (rawProject.supervisionOverrides?.timeZone) {
        try { effectiveZone = validateConfig({ ...cfg, ...rawProject.supervisionOverrides }).timeZone; } catch { /* Global ante override inválido. */ }
      }
      const sourceRevision = hash([2, projectSnap.updateTime?.toMillis() || null, cfg, calendarDay(now(), effectiveZone)]);
      const previous = old.data();
      const expiredSnooze = previous?.decisionState === "snooze" && previous.snoozeUntil <= now().toISOString();
      if (!force && old.exists && previous.sourceRevision === sourceRevision && !expiredSnooze) return previous;
      const project = projectSnap.exists ? await related(rawProject, tx) : null;
      const summary = project ? evaluate(project, cfg) : null;
      const inputRevision = project ? hash([project.title, project.status, project.deadline, project.advances, project.comments,
        project.evidenceFiles, project.externalEvidence, project.deliverables, project.activities, project.milestones,
        project.reviewChecklist, project.assignedToUid, project.assignedToId, project.collaboratorIds, project.supervisionOverrides]) : null;
      const sameInput = previous?.inputRevision === inputRevision;
      const decisionState = sameInput && !expiredSnooze ? previous?.decisionState || "pending" : "pending";
      if (summary) summary.decisionPending = summary.decisionPending && decisionState === "pending";
      const before = previous ? metricsFor(previous) : {};
      const after = summary ? metricsFor(summary) : {};
      const metrics = { ...(stats.data()?.metrics || {}) };
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        metrics[key] = Math.max(0, (metrics[key] || 0) + (after[key] || 0) - (before[key] || 0));
      }
      if (summary) {
        const same = previous?.version === summary.version;
        tx.set(summaries.doc(id), { ...summary, sourceRevision, inputRevision,
          deadlineSort: summary.deadline || "9999-12-31", activitySort: summary.lastActivityAt || "0000-01-01",
          decisionState,
          snoozeUntil: sameInput && !expiredSnooze ? previous?.snoozeUntil || null : null,
          lastReviewedAt: previous?.lastReviewedAt || null,
          lastReviewedVersion: previous?.lastReviewedVersion || null,
        });
        if (!same) {
          for (const source of summary.sources.filter((source) => ["advance", "comment"].includes(source.type) && source.at)) {
            // Clave de evento estable: reintentos no duplican el historial de avances.
            tx.set(ref("activity", hash([id, source.id, source.at, source.text])), { projectId: id, title: summary.title,
              action: "activity", sourceId: source.id, text: source.text, createdAt: source.at });
          }
        }
        if (!same && cfg.alertsEnabled && summary.active && summary.decisionPending) {
          tx.set(ref("alert-history", hash([id, summary.version])), { projectId: id, action: "alert", reasons: summary.reasons, createdAt: summary.computedAt });
          tx.set(ref("alert", id), { projectId: id, title: summary.title, reasons: summary.reasons,
            version: summary.version, computedAt: summary.computedAt });
        } else if (!cfg.alertsEnabled || !summary.active || !summary.decisionPending) tx.delete(ref("alert", id));
      } else {
        tx.delete(summaries.doc(id));
        tx.delete(ref("alert", id));
      }
      tx.set(statsRef, { metrics, computedAt: now().toISOString() }, { merge: true });
      return summary;
    });
  }
  async function overview(data) {
    const cfg = await config();
    const allowedFilters = ["all", "attention", "pendingEvidence", "dueSoon", "decisions", "inactive", "overdue"];
    const filter = data.filter || "all";
    if (!allowedFilters.includes(filter)) error("invalid-argument", "Filtro inválido.");
    const sortFields = { priority: "riskScore", deadline: "deadlineSort", activity: "activitySort" };
    const sort = data.sort || "priority";
    if (!sortFields[sort]) error("invalid-argument", "Orden inválido.");
    // Un índice por filtro/orden, sin consultas que lean colecciones completas.
    let query = summaries;
    const filters = { filter, risk: text(data.risk, 10), status: text(data.status, 80), assigneeUid: text(data.assigneeUid, 128), sort };
    if (filters.risk && !["bajo", "medio", "alto", "critico"].includes(filters.risk)) error("invalid-argument", "Riesgo inválido.");
    // Los filtros adicionales se aplican sobre lotes acotados; el cursor avanza aunque un lote no tenga coincidencias.
    query = query.orderBy(sortFields[sort], sort === "priority" ? "desc" : "asc").orderBy("projectId");
    if (data.cursor) {
      let cursor;
      try { cursor = JSON.parse(Buffer.from(data.cursor, "base64url").toString()); } catch { error("invalid-argument", "Cursor inválido."); }
      if (!cursor || cursor.key !== hash(filters) || typeof cursor.id !== "string"
        || !(typeof cursor.value === "string" || Number.isFinite(cursor.value))) error("invalid-argument", "Cursor inválido.");
      query = query.startAfter(cursor.value, cursor.id);
    }
    const snapshot = await query.limit(SCAN_SIZE).get();
    const items = [];
    let last = null;
    for (const doc of snapshot.docs) {
      const item = doc.data();
      last = item;
      const filterMatch = filter === "all" || (filter === "attention" && item.active && item.risk !== "bajo")
        || (filter === "pendingEvidence" && item.active && item.pendingEvidence > 0)
        || (filter === "decisions" && item.decisionPending) || item[filter] === true;
      if (filterMatch && (!filters.risk || item.risk === filters.risk)
        && (!filters.status || normalize(item.status) === normalize(filters.status))
        && (!filters.assigneeUid || item.assigneeUid === filters.assigneeUid)) items.push(item);
      if (items.length === PAGE_SIZE) break;
    }
    const hasMore = last && (snapshot.size === SCAN_SIZE || last.projectId !== snapshot.docs.at(-1)?.id);
    const stats = await statsRef.get();
    return { items, nextCursor: hasMore ? Buffer.from(JSON.stringify({ key: hash(filters),
      value: last[sortFields[sort]], id: last.projectId })).toString("base64url") : null,
    metrics: stats.data()?.metrics || metricsFor({}), computedAt: stats.data()?.computedAt || null,
    config: cfg, initializing: !stats.data()?.initialized, aiAvailable: aiApproved && Boolean(provider) && cfg.aiEnabled && Boolean(cfg.aiModel),
    automationApproved, aiApproved, scanned: snapshot.size };
  }
  async function refresh(data) {
    const cfg = await config();
    let query = db.collection("projects").orderBy("__name__");
    if (data.cursor) query = query.startAfter(identifier(data.cursor));
    const snapshot = await query.limit(50).get();
    for (const doc of snapshot.docs) await recompute(doc.id, cfg);
    const nextCursor = snapshot.size === 50 ? snapshot.docs.at(-1).id : null;
    await statsRef.set({ ...(!nextCursor ? { initialized: true } : {}), computedAt: now().toISOString() }, { merge: true });
    return { processed: snapshot.size, nextCursor };
  }
  async function detail(data) {
    const id = identifier(data.projectId);
    const cfg = await config();
    const project = await projectContext(id);
    const summary = evaluate(project, cfg);
    const [stored, analysis, history] = await Promise.all([summaries.doc(id).get(), ref("analysis", id).get(),
      db.collection(PRIVATE).where("projectId", "==", id).orderBy("createdAt", "desc").limit(25).get()]);
    return { summary: { ...summary, lastReviewedAt: stored.data()?.lastReviewedAt || null },
      analysis: analysis.data()?.version === summary.version ? analysis.data().analysis : null,
      history: history.docs.map((doc) => ({ id: doc.id, ...doc.data(), createdAt: iso(doc.data().createdAt) })),
      lastReviewedAt: stored.data()?.lastReviewedAt || null, overrides: project.supervisionOverrides || {}, config: cfg };
  }
  function audit(tx, actor, id, action, extras = {}) {
    tx.create(ref("audit", randomUUID()), { projectId: id, action, actorUid: actor.uid, actorName: actor.name,
      createdAt: now().toISOString(), ...extras });
  }
  async function decide(data, actor, action) {
    const id = identifier(data.projectId);
    if (!["review", "attended", "dismiss", "snooze"].includes(action)) error("invalid-argument", "Acción inválida.");
    const cfg = await config();
    const result = await db.runTransaction(async (tx) => {
      const project = await getProject(id, tx);
      const stored = await tx.get(summaries.doc(id));
      const stats = await tx.get(statsRef);
      const summary = evaluate(project, cfg);
      if (summary.version !== data.version) error("failed-precondition", "El proyecto cambió. Actualiza antes de decidir.");
      let snoozeUntil = null;
      if (action === "snooze") {
        const date = new Date(data.snoozeUntil);
        if (!Number.isFinite(date.getTime()) || date <= now() || date.getTime() > now().getTime() + 30 * 86400000) error("invalid-argument", "Posponer requiere fecha futura de hasta 30 días.");
        snoozeUntil = date.toISOString();
      }
      if (action === "review") {
        tx.set(summaries.doc(id), { lastReviewedAt: now().toISOString(), lastReviewedVersion: summary.version }, { merge: true });
      } else {
        if (!stored.exists) error("failed-precondition", "Actualiza el análisis primero.");
        tx.update(summaries.doc(id), { decisionState: action, snoozeUntil, decisionPending: false });
        if (stored.data().decisionPending) tx.set(statsRef, { metrics: { ...stats.data()?.metrics,
          decisions: Math.max(0, (stats.data()?.metrics?.decisions || 0) - 1) } }, { merge: true });
      }
      audit(tx, actor, id, action, { version: summary.version, snoozeUntil });
      return { ok: true };
    });
    return result;
  }
  async function allowedRecipients(project, tx = null) {
    // Mismos permisos que canAccessProject; no heredar asignaciones anidadas sin acceso a proyecto.
    const ids = [...new Set([project.assignedToUid, project.assignedToId, ...(Array.isArray(project.collaboratorIds) ? project.collaboratorIds : [])].filter(Boolean))];
    if (ids.length > 20) error("failed-precondition", "El proyecto tiene más de 20 destinatarios; requiere revisión individual.");
    const recipients = [];
    for (const id of ids) {
      const userRef = db.collection("users").doc(identifier(id));
      const user = tx ? await tx.get(userRef) : await userRef.get();
      if (user.exists && user.data().active === true) recipients.push({ uid: id, name: text(user.data().name, 120) || id });
    }
    return recipients;
  }
  async function prepare(data, actor) {
    if (!Array.isArray(data.projectIds) || !data.projectIds.length || data.projectIds.length > 10) error("invalid-argument", "Selecciona entre 1 y 10 proyectos.");
    if (data.message !== undefined && (typeof data.message !== "string" || data.message.length > 600 || !data.message.trim())) error("invalid-argument", "El mensaje debe contener entre 1 y 600 caracteres.");
    const cfg = await config();
    const items = [];
    for (const id of [...new Set(data.projectIds)]) {
      const project = await getProject(id);
      const summary = evaluate(project, cfg);
      if (!summary.active) error("failed-precondition", "Solo se puede notificar sobre proyectos activos.");
      const recipients = await allowedRecipients(project);
      if (!recipients.length) error("failed-precondition", "No hay destinatarios activos con acceso al proyecto.");
      items.push({ projectId: id, title: summary.title, recipients, version: summary.version,
        message: text(data.message || summary.suggestedMessage, 600), deadline: summary.deadline });
    }
    const draftId = randomUUID();
    const draft = { actorUid: actor.uid, items, createdAt: now().toISOString(), expiresAt: new Date(now().getTime() + 15 * 60000).toISOString(), sent: false };
    await ref("draft", draftId).create({ ...draft, cleanupAt: new Date(now().getTime() + 86400000) });
    return { draftId, expiresAt: draft.expiresAt, items };
  }
  async function send(data, actor) {
    if (data.confirmed !== true) error("failed-precondition", "Confirma los destinatarios y los mensajes.");
    const draftRef = ref("draft", identifier(data.draftId));
    const cfg = await config();
    return db.runTransaction(async (tx) => {
      const draftSnap = await tx.get(draftRef);
      const currentActor = await tx.get(db.collection("users").doc(actor.uid));
      if (!currentActor.exists || currentActor.data().active !== true || currentActor.data().role !== "admin") error("permission-denied", "La autorización de dirección ya no está vigente.");
      const draft = draftSnap.data();
      if (!draft || draft.actorUid !== actor.uid) error("permission-denied", "Borrador no autorizado.");
      if (draft.sent) return { sent: draft.sentCount, alreadySent: true };
      if (draft.expiresAt < now().toISOString()) error("failed-precondition", "La vista previa caducó. Prepara otra.");
      const deliveries = [];
      // Todas las lecturas preceden a la escritura transaccional.
      for (const item of draft.items) {
        const project = await getProject(item.projectId, tx);
        const summary = evaluate(project, cfg);
        const recipients = await allowedRecipients(project, tx);
        if (!summary.active || summary.version !== item.version || hash(recipients) !== hash(item.recipients)) error("failed-precondition", "Cambió el proyecto o sus destinatarios. Revisa otra vista previa.");
        for (const recipient of recipients) {
          const cooldownRef = ref("cooldown", keyFor(item.projectId, recipient.uid));
          const cooldown = await tx.get(cooldownRef);
          if ((cooldown.data()?.until || "") > now().toISOString()) error("resource-exhausted", "Ya se envió un aviso reciente a uno de los destinatarios.");
          deliveries.push({ item, recipient, cooldownRef });
        }
      }
      for (const { item, recipient, cooldownRef } of deliveries) {
        const notificationId = deduplicationDocumentId(`supervision:${data.draftId}:${item.projectId}:${recipient.uid}`);
        const event = { type: "supervision_instruction", module: "projects", entityType: "project", entityId: item.projectId,
          entityName: item.title, title: `Seguimiento: ${item.title}`, message: item.message, route: route(item.projectId),
          actor, deduplicationKey: notificationId, metadata: { source: "direction", draftId: data.draftId, authorizedByUid: actor.uid, deadline: item.deadline } };
        tx.create(db.collection("notifications").doc(notificationId), buildNotificationDocument(event, recipient.uid, FieldValue));
        tx.set(cooldownRef, { until: new Date(now().getTime() + cfg.cooldownHours * 3600000).toISOString() });
      }
      for (const item of draft.items) audit(tx, actor, item.projectId, "sent", { message: item.message, recipientIds: item.recipients.map((r) => r.uid), draftId: data.draftId, responsePending: true });
      tx.update(draftRef, { sent: true, sentAt: now().toISOString(), sentCount: deliveries.length });
      return { sent: deliveries.length, alreadySent: false };
    });
  }
  async function analyze(data) {
    const cfg = await config();
    if (!aiApproved || !cfg.aiEnabled || !provider || !cfg.aiModel) return { status: "disabled", analysis: null, message: "IA desactivada o pendiente de habilitación autorizada en el servidor." };
    const project = await projectContext(identifier(data.projectId));
    const summary = evaluate(project, cfg);
    return analyzeSnapshot(summary, cfg, project.id);
  }
  async function analyzeSnapshot(summary, cfg, scopeId) {
    const key = analysisKey(summary, cfg);
    const analysisRef = ref("analysis", scopeId);
    const stamp = now();
    const usageRef = ref("usage", stamp.toISOString().slice(0, 7));
    const lease = randomUUID();
    // Selección por fuentes completas: jamás cortar JSON ni citas a mitad de un registro.
    const sources = [];
    for (const source of summary.sources) {
      if (JSON.stringify({ sources: [...sources, source] }).length <= cfg.aiMaxInputChars) sources.push(source);
    }
    const reservation = tokenReservation(sources, cfg);
    const cached = await db.runTransaction(async (tx) => {
      const [previous, usage] = await Promise.all([tx.get(analysisRef), tx.get(usageRef)]);
      const prior = previous.data();
      if (prior?.key === key && prior.analysis) return prior.analysis;
      if ((prior?.leaseUntil || "") > stamp.toISOString()) error("aborted", "El análisis ya está en curso.");
      if ((prior?.retryAfter || "") > stamp.toISOString()) error("unavailable", "El proveedor falló recientemente. Intenta más tarde.");
      const consumed = usage.data() || { requests: 0, reservedTokens: 0 };
      if (consumed.requests >= cfg.aiMonthlyRequestLimit || consumed.reservedTokens + reservation > cfg.aiMonthlyTokenLimit) error("resource-exhausted", "Se alcanzó el límite mensual de IA; las reglas continúan disponibles.");
      tx.set(usageRef, { requests: consumed.requests + 1, reservedTokens: consumed.reservedTokens + reservation,
        observedTokens: consumed.observedTokens || 0, updatedAt: stamp.toISOString() });
      tx.set(analysisRef, { lease, leaseUntil: new Date(stamp.getTime() + 90000).toISOString() }, { merge: true });
      return null;
    });
    if (cached) return { status: "cached", analysis: cached };
    try {
      const generated = await provider({ sources, config: cfg });
      const analysis = { ...require("./projectSupervisionAI").validateAnalysis(generated, sources), model: generated.model || cfg.aiModel, generatedAt: now().toISOString(), analyzedSourceIds: sources.map((s) => s.id),
        omittedSources: summary.sources.length - sources.length, filesRead: false,
        tokenCount: Number.isSafeInteger(generated.tokenCount) && generated.tokenCount >= 0 ? generated.tokenCount : 0 };
      await db.runTransaction(async (tx) => {
        const lock = await tx.get(analysisRef);
        const usage = await tx.get(usageRef);
        if (lock.data()?.lease !== lease) error("aborted", "Cambió la ejecución del análisis.");
        tx.set(analysisRef, { key, version: summary.version, analysis, leaseUntil: null, retryAfter: null });
        tx.set(usageRef, { observedTokens: (usage.data()?.observedTokens || 0) + analysis.tokenCount }, { merge: true });
      });
      return { status: "ready", analysis };
    } catch {
      await db.runTransaction(async (tx) => {
        const lock = await tx.get(analysisRef);
        if (lock.data()?.lease === lease) tx.set(analysisRef, { leaseUntil: null, retryAfter: new Date(now().getTime() + 5 * 60000).toISOString(), errorCode: "provider-failure" }, { merge: true });
      });
      return { status: "unavailable", analysis: null, message: "No se pudo validar el análisis del proveedor. Las reglas siguen disponibles." };
    }
  }
  async function configure(data, actor) {
    let cfg;
    try { cfg = validateConfig(data.config); } catch { error("invalid-argument", "Configuración inválida. Revisa tipos, calendario, umbrales y límites."); }
    if ((cfg.automaticNotifications || cfg.reportDaily || cfg.reportWeekly) && !automationApproved) error("failed-precondition", "La automatización requiere aprobación y habilitación explícita del servidor.");
    if (cfg.aiEnabled && !aiApproved) error("failed-precondition", "La IA requiere aprobación de costes y privacidad en el servidor.");
    for (const id of cfg.reportRecipientIds) {
      const user = await db.collection("users").doc(identifier(id)).get();
      if (!user.exists || user.data().active !== true || user.data().role !== "admin") error("invalid-argument", "Los informes internos solo pueden dirigirse a administradores activos.");
    }
    await db.runTransaction(async (tx) => {
      tx.set(settingsRef, { config: cfg, updatedAt: now().toISOString(), updatedByUid: actor.uid });
      audit(tx, actor, "configuration", "configure", { config: cfg });
    });
    return { config: cfg };
  }
  async function configureProject(data, actor) {
    const id = identifier(data.projectId);
    const allowed = ["timeZone", "workDays", "holidays", "inactivityBusinessDays", "reminderDays", "preventiveDays", "urgentDays"];
    const overrides = data.overrides;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides) || Object.keys(overrides).some((key) => !allowed.includes(key))) error("invalid-argument", "Reglas particulares inválidas.");
    try { validateConfig({ ...await config(), ...overrides }); } catch { error("invalid-argument", "Calendario o umbrales particulares inválidos."); }
    await db.runTransaction(async (tx) => {
      await getProject(id, tx);
      tx.update(db.collection("projects").doc(id), { supervisionOverrides: overrides });
      audit(tx, actor, id, "configure-project", { overrides });
    });
    await recompute(id, undefined, true);
    return { overrides };
  }
  async function makeReport(data, actor) {
    const days = data.periodDays || 7;
    if (![1, 7, 30].includes(days)) error("invalid-argument", "Periodo inválido.");
    const stats = await statsRef.get();
    if (!stats.data()?.initialized) error("failed-precondition", "Completa la indexación antes de generar informes.");
    const snapshot = await summaries.orderBy("riskScore", "desc").limit(100).get();
    const since = new Date(now().getTime() - days * 86400000).toISOString();
    const events = await db.collection(PRIVATE).where("createdAt", ">=", since).orderBy("createdAt", "desc").limit(100).get();
    const projects = snapshot.docs.map((doc) => {
      const s = doc.data();
      return { projectId: s.projectId, title: s.title, status: s.status, risk: s.risk,
        deadline: s.deadline, pendingEvidence: s.pendingEvidence, assigneeName: s.assigneeName,
        readyForClosure: s.readyForClosure, reasons: s.reasons.slice(0, 5) };
    });
    const metrics = stats.data().metrics;
    const report = { id: randomUUID(), generatedAt: now().toISOString(), periodDays: days, metrics,
      summary: `${metrics.active || 0} proyectos activos; ${metrics.overdue || 0} vencidos; ${metrics.partialEvidenceProjects ? "Al menos " : ""}${metrics.pendingEvidence || 0} evidencias pendientes conocidas. Estado al generar; actividad desde ${since.slice(0, 10)}.`,
      projects, recentDecisions: events.docs.filter((doc) => doc.id.startsWith("audit-")).map((doc) => ({ projectId: doc.data().projectId, action: doc.data().action, actorName: doc.data().actorName, createdAt: doc.data().createdAt })),
      partial: snapshot.size === 100 || events.size === 100 || metrics.partialEvidenceProjects > 0, computedAt: stats.data().computedAt,
      recentActivity: events.docs.filter((doc) => doc.data().action === "activity").map((doc) => ({ projectId: doc.data().projectId, title: doc.data().title, text: doc.data().text, sourceId: doc.data().sourceId, createdAt: doc.data().createdAt })),
      scope: "Estado actual de todos los proyectos; decisiones y actividad del periodo; hasta 100 proyectos prioritarios y 100 eventos. No constituye un histórico completo anterior a la activación." };
    await ref("report", report.id).create({ ...report, createdAt: report.generatedAt, actorUid: actor.uid });
    return report;
  }
  async function assistantAnalysis(projects) {
    const cfg = await config();
    if (!aiApproved || !cfg.aiEnabled || !provider || !cfg.aiModel || !projects.length) return { used: false, text: "" };
    const sources = projects.slice(0, 10).map((s) => ({ id: `project:${s.projectId}`, type: "project",
      text: `${s.title}: estado ${s.status}; avance reportado ${s.progress}%; plazo ${s.deadline || "no registrado"}; riesgo ${s.risk}; evidencias pendientes ${s.pendingEvidence}. ${s.reasons.map((r) => r.message).join(" ")} Avances posteriores a la revisión explícita: ${(s.sources || []).filter((source) => ["advance", "comment"].includes(source.type) && (!s.lastReviewedAt || source.at > s.lastReviewedAt)).slice(0, 3).map((source) => `${source.id}: ${source.text}`).join("; ") || "sin información textual nueva en la muestra"}`,
      contentAnalyzed: true, at: s.computedAt }));
    const snapshot = { version: hash(sources), sources };
    try {
      const result = await analyzeSnapshot(snapshot, cfg, "assistant");
      return { used: true, text: "\nSíntesis de IA (revisar contra las fuentes):\n" + [...result.analysis.facts, ...result.analysis.inferences, ...result.analysis.recommendations].map((r) => `${r.text} [${r.sourceIds.join(", ")}]`).join("\n") };
    } catch { return { used: false, text: "\nLa síntesis IA no está disponible; se muestran resultados estructurados." }; }
  }
  async function assistant(data, actor) {
    const question = text(data.question, 500);
    if (!question) error("invalid-argument", "Escribe una consulta.");
    const normalized = normalize(question);
    if (data.projectId) {
      const result = await detail(data);
      const s = result.summary;
      const advances = s.sources.filter((source) => ["advance", "comment", "update", "log"].includes(source.type));
      const ai = await assistantAnalysis([s]);
      return { answer: `${s.title}: ${s.status}. Avance reportado ${s.progress}%. ${s.reasons.map((r) => r.message).join(" ")}\n${advances.map((s) => s.text).join("\n") || "No hay avances textuales accesibles en la muestra."}${ai.text}`,
        aiUsed: ai.used, sources: [{ projectId: s.projectId, title: s.title }], draftProjectIds: /mensaje|recordatorio/.test(normalized) && s.active ? [s.projectId] : [] };
    }
    const filter = /vencid|incumpl/.test(normalized) ? "overdue" : /proxim|vencer/.test(normalized) ? "dueSoon"
      : /inactiv|sin actividad/.test(normalized) ? "inactive" : /evidencia/.test(normalized) ? "pendingEvidence" : "attention";
    const view = await overview({ filter });
    const stats = view.metrics;
    let answer = `Estado calculado ${view.computedAt || "pendiente"}: ${stats.active || 0} activos, ${stats.overdue || 0} vencidos, ${stats.pendingEvidence || 0} evidencias pendientes conocidas${stats.partialEvidenceProjects > 0 ? " (conteo parcial)" : ""}.\n`;
    let projects = view.items;
    if (/cerrar|concluir|cierre/.test(normalized)) {
      const snap = await summaries.where("readyForClosure", "==", true).limit(25).get();
      projects = snap.docs.map((doc) => doc.data());
    } else if (/entregable|colaborador/.test(normalized)) {
      const snap = await summaries.where("pendingDeliverables", ">", 0).orderBy("pendingDeliverables", "desc").limit(25).get();
      projects = snap.docs.map((doc) => doc.data());
      answer += "Responsables con entregables, actividades o hitos pendientes; las asignaciones provienen de cada proyecto.\n";
    } else if (/avance|semana|ocurrio|equipo|dias/.test(normalized)) {
      const since = new Date(now().getTime() - (/15/.test(normalized) ? 15 : 7) * 86400000).toISOString();
      const snap = await summaries.where("lastActivityAt", ">=", since).orderBy("lastActivityAt", "desc").limit(25).get();
      projects = snap.docs.map((doc) => doc.data());
      answer += "Proyectos con actividad reciente; abre su detalle para consultar las fuentes textuales.\n";
    } else if (!/atencion|priori|pendiente|vencid|incumpl|proxim|vencer|inactiv|evidencia|mensaje|recordatorio/.test(normalized)) {
      return { answer: "Puedo consultar riesgos, vencimientos, actividad, evidencias y proyectos listos para revisión; preparar mensajes requiere revisión y confirmación humana. Para un resumen específico, selecciona un proyecto.", aiUsed: false, sources: [] };
    }
    answer += projects.map((s) => `${s.title} — ${s.assigneeName || "Sin responsable"}: ${s.status}, riesgo ${s.risk}, ${s.pendingEvidence} evidencias pendientes; ${s.pendingDeliverables || 0} entregables/actividades pendientes.`).join("\n") || "No se encontraron proyectos en esta consulta.";
    if (view.nextCursor || projects.length === 25) answer += "\nMuestra limitada; usa los filtros para continuar.";
    const ai = await assistantAnalysis(projects);
    answer += ai.text;
    return { answer, aiUsed: ai.used, sources: projects.map((s) => ({ projectId: s.projectId, title: s.title })),
      draftProjectIds: /mensaje|recordatorio/.test(normalized) ? projects.filter((s) => s.active).slice(0, 10).map((s) => s.projectId) : [], actorUid: actor.uid };
  }
  async function callable(request) {
    const actor = await admin(request);
    const data = request.data || {};
    const op = text(data.op, 30);
    const operations = { overview: () => overview(data), refresh: () => refresh(data), detail: () => detail(data),
      review: () => decide(data, actor, "review"), decision: () => decide(data, actor, data.action),
      prepare: () => prepare(data, actor), send: () => send(data, actor), analyze: () => analyze(data),
      configure: () => configure(data, actor), configureProject: () => configureProject(data, actor), report: () => makeReport(data, actor), assistant: () => assistant(data, actor),
      people: async () => {
        const snap = await db.collection("users").where("active", "==", true).limit(200).get();
        return { items: snap.docs.map((doc) => ({ uid: doc.id, name: text(doc.data().name, 120) || doc.id, isAdmin: doc.data().role === "admin" })), partial: snap.size === 200 };
      },
      reports: async () => ({ items: (await db.collection(PRIVATE).orderBy("generatedAt", "desc").limit(10).get()).docs.map((doc) => doc.data()) }) };
    if (!Object.hasOwn(operations, op)) error("invalid-argument", "Operación desconocida.");
    await rateLimit(actor, op);
    return operations[op]();
  }

  async function notifyAutomatic(summary, cfg) {
    if (!automationApproved || !cfg.alertsEnabled || !cfg.automaticNotifications || !summary.active) return;
    const projectConfig = (await db.collection("projects").doc(summary.projectId).get()).data()?.supervisionOverrides;
    if (projectConfig && typeof projectConfig === "object") {
      const allowed = ["timeZone", "workDays", "holidays", "inactivityBusinessDays", "reminderDays", "preventiveDays", "urgentDays"];
      try { cfg = validateConfig({ ...cfg, ...Object.fromEntries(Object.entries(projectConfig).filter(([key]) => allowed.includes(key))) }); } catch { /* Calendario global ante override inválido. */ }
    }
    const local = calendarDay(now(), cfg.timeZone);
    const weekday = new Date(`${local}T12:00:00Z`).getUTCDay();
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: cfg.timeZone, hour: "2-digit", hourCycle: "h23" }).format(now()));
    if (!cfg.sendDays.includes(weekday) || cfg.holidays.includes(local) || hour < cfg.sendHour) return;
    const stage = summary.overdue ? "overdue" : summary.daysRemaining !== null && summary.daysRemaining <= cfg.urgentDays && summary.risk !== "bajo" ? "urgent"
      : summary.daysRemaining !== null && summary.daysRemaining <= cfg.preventiveDays && summary.risk !== "bajo" ? "preventive"
        : summary.daysRemaining !== null && summary.daysRemaining <= cfg.reminderDays ? "reminder" : summary.inactive ? "inactive" : null;
    if (!stage) return;
    await db.runTransaction(async (tx) => {
      const project = await getProject(summary.projectId, tx);
      const fresh = evaluate(project, cfg);
      const stored = await tx.get(summaries.doc(summary.projectId));
      if (!fresh.active || fresh.version !== summary.version) return;
      if (stored.data()?.decisionState === "snooze" && stored.data()?.snoozeUntil > now().toISOString()) return;
      if (["dismiss", "attended"].includes(stored.data()?.decisionState)) return;
      const recipients = await allowedRecipients(project, tx);
      const records = [];
      for (const recipient of recipients) {
        const id = deduplicationDocumentId(`supervision-auto:${summary.projectId}:${fresh.deadline}:${stage}:${recipient.uid}`);
        const notificationRef = db.collection("notifications").doc(id);
        const cooldownRef = ref("cooldown", keyFor(summary.projectId, recipient.uid));
        const [existing, cooldown] = await Promise.all([tx.get(notificationRef), tx.get(cooldownRef)]);
        if (!existing.exists && (cooldown.data()?.until || "") <= now().toISOString()) records.push({ recipient, notificationRef, cooldownRef, id });
      }
      for (const record of records) {
        tx.create(record.notificationRef, buildNotificationDocument({ type: "supervision_reminder", module: "projects", entityType: "project",
          entityId: summary.projectId, entityName: fresh.title, title: `Recordatorio: ${fresh.title}`, message: fresh.suggestedMessage,
          route: route(summary.projectId), actor: { uid: "", name: "Supervisión automática" }, deduplicationKey: record.id,
          metadata: { source: "automatic", stage, deadline: fresh.deadline } }, record.recipient.uid, FieldValue));
        tx.set(record.cooldownRef, { until: new Date(now().getTime() + cfg.cooldownHours * 3600000).toISOString() });
      }
      if (records.length) audit(tx, { uid: "system", name: "Motor de reglas" }, summary.projectId, "automatic-reminder", { stage, recipientIds: records.map((r) => r.recipient.uid) });
    });
  }
  async function scheduledReports(cfg) {
    if (!automationApproved || (!cfg.reportDaily && !cfg.reportWeekly)) return;
    const local = calendarDay(now(), cfg.timeZone);
    const weekday = new Date(`${local}T12:00:00Z`).getUTCDay();
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: cfg.timeZone, hour: "2-digit", hourCycle: "h23" }).format(now()));
    if (hour < cfg.sendHour || !cfg.sendDays.includes(weekday) || cfg.holidays.includes(local)) return;
    if (!cfg.reportDaily && !(cfg.reportWeekly && weekday === cfg.reportWeekday)) return;
    const periods = [...(cfg.reportDaily ? [1] : []), ...(cfg.reportWeekly && weekday === cfg.reportWeekday ? [7] : [])];
    for (const periodDays of periods) {
    const jobRef = ref("report-job", `${local}-${periodDays}`);
    const owner = randomUUID();
    const claimed = await db.runTransaction(async (tx) => {
      const job = await tx.get(jobRef);
      if (job.data()?.done || job.data()?.until > now().toISOString()) return false;
      tx.set(jobRef, { owner, until: new Date(now().getTime() + 300000).toISOString() });
      return true;
    });
    if (!claimed) continue;
    const report = await makeReport({ periodDays }, { uid: "system", name: "Motor de reglas" });
    // No incluir análisis internos en el mensaje; enlace exclusivo para administradores.
    await db.runTransaction(async (tx) => {
      const job = await tx.get(jobRef);
      if (job.data()?.owner !== owner) return;
      const recipients = [];
      for (const id of cfg.reportRecipientIds) {
        const user = await tx.get(db.collection("users").doc(identifier(id)));
        if (user.exists && user.data().active === true && user.data().role === "admin") recipients.push(id);
      }
      for (const id of recipients) {
        const notificationId = deduplicationDocumentId(`supervision-report:${local}:${periodDays}:${id}`);
        tx.set(db.collection("notifications").doc(notificationId), buildNotificationDocument({ type: "supervision_report", module: "projects",
          entityType: "report", entityId: report.id, title: "Informe ejecutivo disponible", message: "Se generó el informe interno de supervisión. Accede como dirección para consultarlo.",
          route: "/?page=all-projects&tab=supervision", actor: { uid: "", name: "Supervisión automática" }, deduplicationKey: notificationId,
          metadata: { reportId: report.id, source: "automatic" } }, id, FieldValue));
      }
      tx.set(jobRef, { done: true, reportId: report.id, completedAt: now().toISOString() });
    });
    }
  }

  async function directionDigest(cfg) {
    if (!automationApproved || !cfg.alertsEnabled || !cfg.automaticNotifications) return;
    const local = calendarDay(now(), cfg.timeZone);
    const weekday = new Date(`${local}T12:00:00Z`).getUTCDay();
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: cfg.timeZone, hour: "2-digit", hourCycle: "h23" }).format(now()));
    if (hour < cfg.sendHour || !cfg.sendDays.includes(weekday) || cfg.holidays.includes(local)) return;
    await db.runTransaction(async (tx) => {
      const doneRef = ref("digest", local);
      const [done, stats, users] = await Promise.all([tx.get(doneRef), tx.get(statsRef),
        tx.get(db.collection("users").where("role", "==", "admin").limit(100))]);
      if (done.exists || !stats.data()?.initialized || !(stats.data()?.metrics?.pendingEvidence > 0)) return;
      const count = stats.data().metrics.pendingEvidence;
      for (const user of users.docs.filter((doc) => doc.data().active === true)) {
        const id = deduplicationDocumentId(`supervision-evidence-digest:${local}:${user.id}`);
        tx.create(db.collection("notifications").doc(id), buildNotificationDocument({ type: "supervision_digest", module: "projects",
          entityType: "report", entityId: `evidence-${local}`, title: "Evidencias pendientes de revisión",
          message: `Hay ${count} evidencias pendientes. Revisa el panel de supervisión; abrirlas no las aprueba.`,
          route: "/?page=all-projects&tab=supervision", actor: { uid: "", name: "Supervisión automática" }, deduplicationKey: id,
          metadata: { source: "automatic", grouped: true } }, user.id, FieldValue));
      }
      tx.create(doneRef, { completedAt: now().toISOString(), count });
    });
  }
  async function scheduled() {
    const cfg = await config();
    const jobRef = ref("job", "scan");
    const owner = randomUUID();
    const job = await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      if ((snap.data()?.until || "") > now().toISOString()) return null;
      const value = { owner, cursor: snap.data()?.cursor || null, until: new Date(now().getTime() + 8 * 60000).toISOString() };
      tx.set(jobRef, value);
      return value;
    });
    if (!job) return;
    try {
      const result = await refresh({ cursor: job.cursor });
      let query = summaries.orderBy("projectId");
      if (job.cursor) query = query.startAfter(job.cursor);
      const snapshot = await query.limit(50).get();
      let analyzed = 0;
      for (const doc of snapshot.docs) {
        if (aiApproved && cfg.aiEnabled && provider && cfg.aiModel && analyzed < 3 && doc.data().active) {
          const cached = await ref("analysis", doc.id).get();
          if (cached.data()?.key !== analysisKey(doc.data(), cfg)) {
            try { const result = await analyze({ projectId: doc.id }); if (result.status !== "cached") analyzed += 1; }
            catch { analyzed += 1; /* Presupuesto/lease: las reglas continúan. */ }
          }
        }
        try { await notifyAutomatic(doc.data(), cfg); } catch { /* Se reintenta en el siguiente ciclo; sin datos sensibles en logs. */ }
      }
      await jobRef.set({ cursor: result.nextCursor, until: null, completedAt: now().toISOString() });
      await scheduledReports(cfg);
      await directionDigest(cfg);
      const expired = await db.collection(PRIVATE).where("cleanupAt", "<=", now()).limit(100).get();
      if (!expired.empty) { const batch = db.batch(); expired.docs.forEach((doc) => batch.delete(doc.ref)); await batch.commit(); }
    } catch (err) {
      await jobRef.set({ until: null, errorCode: "scan-failed" }, { merge: true });
      throw err;
    }
  }
  async function projectWritten(event) {
    return recompute(event.params.projectId, undefined, true);
  }
  async function relatedWritten(event) {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    for (const id of new Set([before?.projectId, after?.projectId].filter(Boolean))) await recompute(identifier(id), undefined, true);
  }
  return { callable, scheduled, projectWritten, relatedWritten, recompute, config, overview, refresh, analyze, notifyAutomatic };
}
module.exports = { createSupervisionHandlers, PRIVATE, SUMMARIES };
