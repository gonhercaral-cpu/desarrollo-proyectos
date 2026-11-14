// One writer per playlist. Coalesce edits made while a write is in flight.
export function createPlaylistSaveQueue({ write, onStatus = () => {} }) {
  const entries = new Map();

  async function drain(id, entry) {
    if (entry.running) return entry.running;
    entry.running = (async () => {
      while (entry.pending) {
        const snapshot = entry.pending;
        onStatus(id, "saving");
        try {
          await write(id, snapshot);
          if (entry.pending === snapshot) entry.pending = null;
        } catch (error) {
          // Retain the newest local edit for explicit retry; never restore stale data.
          entry.error = error;
          onStatus(id, "error", error);
          return;
        }
      }
      entry.error = null;
      onStatus(id, "saved");
    })();
    await entry.running;
    entry.running = null;
  }

  return {
    enqueue(id, items) {
      const entry = entries.get(id) || { pending: null, running: null };
      entries.set(id, entry);
      entry.pending = items;
      entry.error = null;
      return drain(id, entry);
    },
    retry(id) {
      const entry = entries.get(id);
      if (entry) return drain(id, entry);
    },
    pending(id) {
      return entries.get(id)?.pending || null;
    },
    hasPending() {
      return [...entries.values()].some((entry) => entry.pending);
    },
    async flush() {
      await Promise.all([...entries.values()].map((entry) => entry.running));
      const failed = [...entries.values()].find((entry) => entry.pending);
      if (failed) throw failed.error || new Error("Hay cambios pendientes de guardar.");
    },
  };
}
