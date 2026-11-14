import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlaylistSaveQueue } from "../src/utils/digitalSignage/playlistSaveQueue.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("serializa por playlist y agrupa cambios sin restaurar un orden atrasado", async () => {
  const first = deferred();
  const writes = [];
  const statuses = [];
  const queue = createPlaylistSaveQueue({
    write: async (id, items) => {
      writes.push([id, items]);
      if (writes.length === 1) await first.promise;
    },
    onStatus: (_, status) => statuses.push(status),
  });
  const work = queue.enqueue("p", [1, 2, 3]);
  queue.enqueue("p", [3, 1, 2]);
  queue.enqueue("p", [2, 3, 1]);
  assert.equal(writes.length, 1);
  first.resolve();
  await work;
  await queue.flush();
  assert.deepEqual(writes, [["p", [1, 2, 3]], ["p", [2, 3, 1]]]);
  assert.equal(queue.hasPending(), false);
  assert.equal(statuses.at(-1), "saved");
});

test("conserva edición más reciente al fallar y reintenta explícitamente", async () => {
  let fail = true;
  const writes = [];
  const queue = createPlaylistSaveQueue({ write: async (_, items) => {
    if (fail) throw new Error("sin conexión");
    writes.push(items);
  } });
  await queue.enqueue("p", [2, 1]);
  assert.deepEqual(queue.pending("p"), [2, 1]);
  await assert.rejects(queue.flush(), /sin conexión/);
  fail = false;
  await queue.retry("p");
  assert.deepEqual(writes, [[2, 1]]);
  assert.equal(queue.hasPending(), false);
});

test("guarda playlists diferentes sin mezclar cambios", async () => {
  const gate = deferred();
  const writes = [];
  const queue = createPlaylistSaveQueue({ write: async (id, items) => {
    if (id === "a") await gate.promise;
    writes.push([id, items]);
  } });
  const work = queue.enqueue("a", [1]);
  await queue.enqueue("b", [2]);
  assert.deepEqual(writes, [["b", [2]]]);
  gate.resolve();
  await work;
  await queue.flush();
  assert.deepEqual(writes.at(-1), ["a", [1]]);
});
