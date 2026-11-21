'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../functions/projectSupervisionEngine.js');

// 2026-11-18 es miércoles; 10:00 en America/Tijuana (PST, UTC-8).
const NOW = new Date('2026-11-18T18:00:00Z');

const cfg = (o) => E.validateConfig(o);
const proj = (o) =>
  Object.assign(
    {
      id: 'p1',
      title: 'Proyecto',
      status: 'En progreso',
      deadline: '2026-12-31',
      progress: 40,
      assignedToUid: 'u1',
      createdAt: '2026-11-01T18:00:00Z',
      advances: [{ id: 'a1', text: 'Avance', createdAt: '2026-11-17T18:00:00Z' }],
    },
    o || {}
  );
const run = (p, now, c) => E.evaluateProject(p, cfg(c), now || NOW);
const ready = (o) =>
  proj(
    Object.assign(
      {
        status: 'Listo para revisión',
        evidenceFiles: [{ id: 'e1', filePath: 'p1/a.pdf', fileName: 'a.pdf', reviewStatus: 'approved', uploadedAt: '2026-11-17T18:00:00Z' }],
        reviewChecklist: { enabled: true, items: [{ id: 'c1', label: 'Revisado', checked: true }] },
      },
      o || {}
    )
  );

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test('DEFAULT_CONFIG y validateConfig por defecto', () => {
  assert.deepEqual(E.validateConfig(), E.DEFAULT_CONFIG);
  assert.deepEqual(E.validateConfig(null), E.DEFAULT_CONFIG);
  assert.equal(E.DEFAULT_CONFIG.alertsEnabled, false);
  assert.equal(E.DEFAULT_CONFIG.timeZone, 'America/Tijuana');
  const merged = E.validateConfig({ aiModel: 'gemini-2.5-flash', alertsEnabled: true });
  assert.equal(merged.aiModel, 'gemini-2.5-flash');
  assert.equal(merged.alertsEnabled, true);
  assert.equal(merged.reminderDays, 15);
});

test('validateConfig rechaza configuraciones inválidas', () => {
  const invalid = [
    { foo: 1 },
    { alertsEnabled: 'true' },
    { aiEnabled: 1 },
    { reminderDays: '15' },
    { reminderDays: 1.5 },
    { reminderDays: 366 },
    { timeZone: 'Mars/Base' },
    { timeZone: 5 },
    { urgentDays: 10 },
    { preventiveDays: 20 },
    { workDays: [] },
    { workDays: [7] },
    { sendDays: ['1'] },
    { sendHour: 24 },
    { holidays: ['2026-02-30'] },
    { holidays: '2026-12-25' },
    { reportRecipientIds: new Array(21).fill('a') },
    { reportRecipientIds: ['a/b'] },
    { reportRecipientIds: ['x'.repeat(129)] },
    { aiModel: 'gpt-4' },
    { aiModel: 'gemini-' + 'X' },
    { aiMaxOutputTokens: 50 },
    { aiMaxInputChars: 25000 },
    { aiMonthlyTokenLimit: 20000001 },
    { aiMonthlyRequestLimit: 10001 },
    'texto',
    [],
  ];
  for (const input of invalid) {
    assert.throws(() => E.validateConfig(input), RangeError, JSON.stringify(input));
  }
  assert.throws(() => E.validateConfig({ urgentDays: 10 }), (e) => Array.isArray(e.errors) && e.errors.length > 0);
});

test('calendarDay respeta zona horaria, DST y fechas simples', () => {
  assert.equal(E.calendarDay('2026-11-18', 'Asia/Tokyo'), '2026-11-18');
  assert.equal(E.calendarDay('2026-11-19T07:30:00Z', 'America/Tijuana'), '2026-11-18');
  assert.equal(E.calendarDay('2026-10-15T06:30:00Z', 'America/Tijuana'), '2026-10-14');
  assert.equal(E.calendarDay('2026-11-15T07:30:00Z', 'America/Tijuana'), '2026-11-14');
  assert.equal(E.calendarDay('no es fecha', 'America/Tijuana'), null);
  assert.equal(E.calendarDay(undefined), null);
});

test('businessDaysBetween excluye inicio, incluye fin, fines de semana y festivos', () => {
  const base = cfg();
  assert.equal(E.businessDaysBetween('2026-11-02', '2026-11-09', base), 5);
  assert.equal(E.businessDaysBetween('2026-11-02', '2026-11-11', base), 7);
  assert.equal(E.businessDaysBetween('2026-11-02', '2026-11-11', cfg({ holidays: ['2026-11-04'] })), 6);
  assert.equal(E.businessDaysBetween('2026-11-11', '2026-11-02', base), 0);
  assert.equal(E.businessDaysBetween('2026-11-02', '2026-11-02', base), 0);
  assert.equal(E.businessDaysBetween('basura', '2026-11-02', base), 0);
  const long = E.businessDaysBetween('2000-01-01', '2026-11-18', base);
  assert.ok(long > 0 && long <= 3660);
});

test('vencimiento hoy no es vencido; al día siguiente local es crítico', () => {
  const today = run(proj({ deadline: '2026-11-18' }), new Date('2026-11-19T06:00:00Z'));
  assert.equal(today.daysRemaining, 0);
  assert.equal(today.overdue, false);
  assert.equal(today.dueSoon, true);
  const late = run(proj({ deadline: '2026-11-18' }), new Date('2026-11-19T08:30:00Z'));
  assert.equal(late.daysRemaining, -1);
  assert.equal(late.overdue, true);
  assert.equal(late.risk, 'critico');
  assert.equal(late.riskScore, 100);
  assert.ok(late.reasons.some((r) => r.code === 'DEADLINE_OVERDUE'));
});

test('7 días laborales de inactividad y festivo', () => {
  const p = proj({ advances: [{ id: 'a1', text: 'x', createdAt: '2026-11-02T18:00:00Z' }] });
  const now = new Date('2026-11-11T18:00:00Z');
  const r = run(p, now);
  assert.equal(r.inactive, true);
  assert.equal(r.risk, 'medio');
  const holiday = run(p, now, { holidays: ['2026-11-04'] });
  assert.equal(holiday.inactive, false);
  assert.equal(holiday.risk, 'bajo');
});

test('supervisionOverrides permitidos aplican y los no permitidos se ignoran', () => {
  const advances = [{ id: 'a1', text: 'x', createdAt: '2026-11-02T18:00:00Z' }];
  const now = new Date('2026-11-11T18:00:00Z');
  const c = { holidays: ['2026-11-04'] };
  const withOverride = run(proj({ advances, supervisionOverrides: { inactivityBusinessDays: 5 } }), now, c);
  assert.equal(withOverride.inactive, true);
  const bad = run(proj({ advances, supervisionOverrides: { alertsEnabled: true } }), now, c);
  assert.equal(bad.inactive, false);
  assert.ok(bad.missingInformation.some((m) => /supervisionOverrides/.test(m)));
});

test('alto avance con plazo corto y sin bloqueo no es riesgo alto', () => {
  const r = run(proj({ progress: 95, deadline: '2026-11-20' }));
  assert.equal(r.daysRemaining, 2);
  assert.equal(r.dueSoon, true);
  assert.equal(r.risk, 'bajo');
  assert.equal(r.decisionPending, false);
  assert.ok(!r.reasons.some((x) => x.code === 'DEADLINE_URGENT'));
});

test('bloqueos o elementos vencidos con plazo corto elevan a alto; con plazo lejano a medio', () => {
  const blocked = { deliverables: [{ id: 'd1', title: 'E', status: 'Bloqueado', blocked: true }] };
  const near = run(proj(Object.assign({ deadline: '2026-11-20' }, blocked)));
  assert.equal(near.risk, 'alto');
  assert.ok(near.reasons.some((x) => x.code === 'DEADLINE_URGENT'));
  const overdueItem = { milestones: [{ id: 'm1', title: 'H', deadline: '2026-11-10', completed: false }] };
  assert.equal(run(proj(Object.assign({ deadline: '2026-11-20' }, overdueItem))).risk, 'alto');
  const far = run(proj(blocked));
  assert.equal(far.risk, 'medio');
  assert.equal(far.decisionPending, true);
});

test('recordatorio de 15 días es informativo y no eleva el riesgo', () => {
  const r = run(proj({ deadline: '2026-11-30' }));
  assert.equal(r.risk, 'bajo');
  assert.equal(r.riskScore, 0);
  assert.ok(r.reasons.some((x) => x.code === 'REMINDER_WINDOW'));
});

test('estados terminales y ocultos no generan alertas ni cierre', () => {
  const statuses = ['Finalizado', 'terminado', 'completed', 'Cerrado', 'Cancelado', 'cancelled', 'eliminado', 'deleted', 'archived', 'Archivado', 'suspended', 'Suspendido', 'Pausado', 'En pausa'];
  for (const status of statuses) {
    const r = run(proj({ status, deadline: '2026-11-01', evidenceFiles: [{ id: 'e', filePath: 'x', reviewStatus: 'pending' }] }));
    assert.equal(r.active, false, status);
    assert.equal(r.risk, 'bajo', status);
    assert.equal(r.overdue, false, status);
    assert.equal(r.pendingEvidence, 0, status);
    assert.equal(r.decisionPending, false, status);
    assert.equal(r.readyForClosure, false, status);
    assert.deepEqual(r.reasons, [], status);
    assert.equal(r.suggestedMessage, '', status);
  }
  for (const extra of [{ active: false }, { hidden: true }, { deleted: true }]) {
    const r = run(proj(Object.assign({ deadline: '2026-11-01' }, extra)));
    assert.equal(r.active, false);
    assert.equal(r.risk, 'bajo');
  }
  const done = E.metricsFor(run(proj({ status: 'Finalizado' })));
  assert.deepEqual(done, { active: 0, completed: 1, attention: 0, pendingEvidence: 0, dueSoon: 0, decisions: 0, inactive: 0, overdue: 0, readyForClosure: 0, partialEvidenceProjects: 0 });
  assert.equal(E.metricsFor(run(proj({ status: 'Pausado' }))).completed, 0);
});

test('estado desconocido queda visible en missingInformation', () => {
  const r = run(proj({ status: 'Zzz raro' }));
  assert.equal(r.active, true);
  assert.ok(r.missingInformation.some((m) => m.indexOf('Zzz raro') !== -1));
  const none = run(proj({ status: undefined }));
  assert.ok(none.missingInformation.some((m) => /estado/i.test(m)));
});

test('falta de fecha y actividad se reporta como información insuficiente', () => {
  const r = run({ id: 'p9', title: 'Sin datos', status: 'En progreso' });
  assert.ok(r.missingInformation.some((m) => /fecha l[ií]mite/i.test(m)));
  assert.ok(r.missingInformation.some((m) => /actividad verificable/i.test(m)));
  assert.equal(r.lastActivityAt, null);
  assert.equal(r.deadline, null);
  assert.equal(r.daysRemaining, null);
  assert.equal(r.inactive, false);
  assert.equal(r.risk, 'bajo');
});

test('updatedAt no cuenta como actividad; createdAt es el respaldo', () => {
  const p = proj({ advances: [], createdAt: '2026-09-01T18:00:00Z', updatedAt: '2026-11-18T17:00:00Z', history: [{ type: 'Edición', title: 'x', createdAt: '2026-11-18T17:00:00Z' }] });
  const r = run(p);
  assert.equal(r.lastActivityAt, '2026-09-01T18:00:00.000Z');
  assert.equal(r.inactive, true);
  const noCreated = run({ id: 'p2', title: 'T', status: 'En progreso', deadline: '2026-12-31', updatedAt: '2026-11-18T17:00:00Z' });
  assert.equal(noCreated.lastActivityAt, null);
  assert.ok(noCreated.missingInformation.some((m) => /actividad verificable/i.test(m)));
});

test('history Avance/Comentario y lastProgressAt cuentan como actividad', () => {
  const p = proj({
    advances: [],
    history: [
      { type: 'Avance', title: 'a', createdAt: '2026-11-16T18:00:00Z' },
      { type: 'Cambio de estado', title: 'b', createdAt: '2026-11-18T10:00:00Z' },
    ],
  });
  assert.equal(run(p).lastActivityAt, '2026-11-16T18:00:00.000Z');
  assert.equal(run(proj({ advances: [], lastProgressAt: '2026-11-17T12:00:00Z' })).lastActivityAt, '2026-11-17T12:00:00.000Z');
});

test('timestamps en formatos Date, string, seconds y toDate', () => {
  const seconds = Date.parse('2026-11-17T18:00:00Z') / 1000;
  const p = proj({
    advances: [
      { id: 'a1', text: 'x', createdAt: { seconds, nanoseconds: 0 } },
      { id: 'a2', text: 'y', createdAt: { toDate: () => new Date('2026-11-17T20:00:00Z') } },
      { id: 'a3', text: 'z', createdAt: new Date('2026-11-17T19:00:00Z') },
    ],
  });
  const r = run(p);
  assert.equal(r.lastActivityAt, '2026-11-17T20:00:00.000Z');
  assert.equal(run(proj({ advances: [{ id: 'a1', createdAt: { seconds, nanoseconds: 0 } }] })).lastActivityAt, '2026-11-17T18:00:00.000Z');
});

test('evidencias duplicadas: project.evidenceFiles es autoritativo', () => {
  const p = proj({
    evidenceFiles: [{ id: 'e1', filePath: 'a/b.pdf', fileName: 'b.pdf', reviewStatus: 'approved', uploadedAt: '2026-11-17T18:00:00Z' }],
    advances: [{ id: 'a1', text: 'x', createdAt: '2026-11-17T18:00:00Z', files: [{ filePath: 'a/b.pdf', fileName: 'b.pdf', reviewStatus: 'pending' }] }],
  });
  const r = run(p);
  assert.equal(r.pendingEvidence, 0);
  const ev = r.sources.filter((s) => s.type === 'evidence');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].contentAnalyzed, false);
  assert.ok(ev[0].id.startsWith('evidence:'));
  const onlyAdvance = run(proj({ advances: [{ id: 'a1', text: 'x', createdAt: '2026-11-17T18:00:00Z', files: [{ filePath: 'z/y.png', fileName: 'y.png' }] }] }));
  assert.equal(onlyAdvance.pendingEvidence, 1);
  assert.equal(onlyAdvance.decisionPending, true);
  assert.equal(onlyAdvance.risk, 'bajo');
});

test('evidencia rechazada eleva a medio y no cuenta como pendiente', () => {
  const r = run(proj({ evidenceFiles: [{ id: 'e1', filePath: 'a.pdf', fileName: 'a.pdf', reviewStatus: 'rechazado' }] }));
  assert.equal(r.pendingEvidence, 0);
  assert.equal(r.risk, 'medio');
  assert.ok(r.reasons.some((x) => x.code === 'EVIDENCE_REJECTED' && x.source.startsWith('evidence:')));
});

test('cierre sugerido solo con revisión, evidencias aprobadas, checklist completa y sin pendientes', () => {
  const ok = run(ready());
  assert.equal(ok.readyForClosure, true);
  assert.equal(ok.decisionPending, true);
  assert.equal(run(ready({ status: 'ready_for_review' })).readyForClosure, true);
  assert.equal(run(ready({ status: 'En progreso' })).readyForClosure, false);
  assert.equal(run(ready({ evidenceFiles: [] })).readyForClosure, false);
  assert.equal(run(ready({ evidenceFiles: [{ id: 'e1', filePath: 'a', reviewStatus: 'pending' }] })).readyForClosure, false);
  assert.equal(run(ready({ evidenceFiles: [{ id: 'e1', filePath: 'a', reviewStatus: 'rejected' }] })).readyForClosure, false);
  assert.equal(run(ready({ reviewChecklist: { enabled: true, items: [{ id: 'c1', checked: false }] } })).readyForClosure, false);
  assert.equal(run(ready({ reviewChecklist: { enabled: false, items: [{ id: 'c1', checked: true }] } })).readyForClosure, false);
  assert.equal(run(ready({ reviewChecklist: undefined })).readyForClosure, false);
  assert.equal(run(ready({ deliverables: [{ id: 'd', title: 't', completed: false }] })).readyForClosure, false);
  assert.equal(run(ready({ deliverables: [{ id: 'd', title: 't', completed: true, blocked: false }] })).readyForClosure, true);
  assert.equal(run(ready({ deliverables: [{ id: 'd', title: 't', status: 'Bloqueado', blocked: true }] })).readyForClosure, false);
});

test('fuentes únicas y acotadas', () => {
  const advances = [];
  for (let i = 0; i < 25; i += 1) advances.push({ id: 'x', text: 'avance ' + i, createdAt: '2026-11-' + String(1 + (i % 17)).padStart(2, '0') + 'T18:00:00Z' });
  const comments = [];
  for (let i = 0; i < 5; i += 1) comments.push({ id: 'x', text: 'comentario ' + i, createdAt: '2026-11-10T18:00:00Z' });
  const evidenceFiles = [];
  for (let i = 0; i < 15; i += 1) evidenceFiles.push({ id: 'e' + i, filePath: 'f/' + i + '.pdf', fileName: i + '.pdf', reviewStatus: 'approved', uploadedAt: '2026-11-10T18:00:00Z' });
  const r = run(proj({ advances, comments, evidenceFiles }));
  const activity = r.sources.filter((s) => s.type === 'advance' || s.type === 'comment');
  assert.equal(activity.length, 20);
  assert.equal(r.sources.filter((s) => s.type === 'evidence').length, 10);
  assert.equal(new Set(r.sources.map((s) => s.id)).size, r.sources.length);
  assert.ok(r.sources.some((s) => s.id === 'project:p1'));
  assert.ok(r.sources.filter((s) => s.type === 'evidence').every((s) => s.contentAnalyzed === false));
});

test('forma exacta de la salida y métricas', () => {
  const r = run(proj({ deadline: '2026-11-10' }));
  assert.deepEqual(Object.keys(r), [
    'projectId', 'title', 'status', 'assigneeUid', 'assigneeName', 'deadline', 'progress', 'active', 'risk', 'riskScore', 'reasons', 'daysRemaining', 'inactive', 'overdue', 'dueSoon', 'pendingEvidence', 'decisionPending', 'readyForClosure', 'missingInformation', 'lastActivityAt', 'sources', 'suggestedMessage', 'computedAt', 'version',
  ]);
  assert.equal(r.computedAt, NOW.toISOString());
  assert.equal(typeof r.version, 'string');
  assert.deepEqual(E.metricsFor(r), { active: 1, completed: 0, attention: 1, pendingEvidence: 0, dueSoon: 0, decisions: 1, inactive: 0, overdue: 1, readyForClosure: 0, partialEvidenceProjects: 0 });
  assert.equal(run(proj({ progress: 250 })).progress, 100);
  assert.equal(run(proj({ progress: -5 })).progress, 0);
});

test('serialización y versión deterministas', () => {
  const p = proj({ deadline: '2026-11-20' });
  const a = run(p);
  const b = run(p);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const sameDay = run(p, new Date('2026-11-18T20:00:00Z'));
  assert.equal(sameDay.version, a.version);
  assert.notEqual(sameDay.computedAt, a.computedAt);
  const nextDay = run(p, new Date('2026-11-19T20:00:00Z'));
  assert.notEqual(nextDay.version, a.version);
  const other = run(p, NOW, { urgentDays: 2 });
  assert.notEqual(other.version, a.version);
  assert.equal(E.hash({ b: 1, a: [1, 2] }), E.hash({ a: [1, 2], b: 1 }));
  assert.notEqual(E.hash({ a: 1 }), E.hash({ a: 2 }));
});

test('normalize', () => {
  assert.equal(E.normalize('  Listo_para-Revisión  '), 'listo para revision');
  assert.equal(E.normalize('En   Pausa'), 'en pausa');
  assert.equal(E.normalize(null), '');
});

test('no muta project ni config', () => {
  const p = deepFreeze(
    proj({
      evidenceFiles: [{ id: 'e1', filePath: 'a/b.pdf', fileName: 'b.pdf', reviewStatus: 'pending', uploadedAt: '2026-11-17T18:00:00Z' }],
      deliverables: [{ id: 'd1', title: 'E', deadline: '2026-11-10', completed: false }],
      supervisionOverrides: { inactivityBusinessDays: 5 },
    })
  );
  const c = deepFreeze(cfg({ holidays: ['2026-11-04'] }));
  const pSnapshot = structuredClone(p);
  const cSnapshot = structuredClone(c);
  const r = E.evaluateProject(p, c, NOW);
  E.metricsFor(r);
  assert.deepEqual(p, pSnapshot);
  assert.deepEqual(c, cSnapshot);
});

test('entradas inválidas lanzan errores claros', () => {
  assert.throws(() => E.evaluateProject(null, cfg(), NOW), TypeError);
  assert.throws(() => E.evaluateProject(proj(), cfg(), 'no-fecha'), TypeError);
  assert.throws(() => E.evaluateProject(proj(), { foo: 1 }, NOW), RangeError);
});

test('métricas cuentan archivos pendientes y estados reales del sistema', () => {
  const s = run(proj({ status: 'En proceso', evidenceFiles: [{id:'e1'}, {id:'e2'}] }));
  assert.equal(s.missingInformation.some((m) => m.includes('Estado no reconocido')), false);
  assert.equal(E.metricsFor(s).pendingEvidence, 2);
});
