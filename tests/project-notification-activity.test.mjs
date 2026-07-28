import test from "node:test";
import assert from "node:assert/strict";
import { buildUnreadActivityByProject } from "../src/utils/projectNotificationActivity.js";

test("agrupa actividad no leída por proyecto y detecta comentarios", () => {
  const activity = buildUnreadActivityByProject([
    {
      id: "n1",
      projectId: "project-a",
      tipo: "PROJECT_UPDATED",
      read: false,
      createdAt: { seconds: 10 },
    },
    {
      id: "n2",
      projectId: "project-a",
      tipo: "COMMENT_ADDED",
      read: false,
      createdAt: { seconds: 20 },
    },
    {
      id: "n3",
      projectId: "project-b",
      tipo: "STATUS_CHANGED",
      read: false,
      createdAt: { seconds: 15 },
    },
  ]);

  assert.equal(activity["project-a"].count, 2);
  assert.equal(activity["project-a"].hasNewComments, true);
  assert.deepEqual(activity["project-a"].latestActivityAt, { seconds: 20 });
  assert.equal(activity["project-b"].count, 1);
});

test("ignora notificaciones leídas y ajenas a proyectos", () => {
  const activity = buildUnreadActivityByProject([
    { projectId: "project-a", read: true, tipo: "COMMENT_ADDED" },
    { editorialProjectId: "editorial-a", read: false, tipo: "EDITORIAL_COMMENT" },
    null,
  ]);

  assert.deepEqual(activity, {});
});
