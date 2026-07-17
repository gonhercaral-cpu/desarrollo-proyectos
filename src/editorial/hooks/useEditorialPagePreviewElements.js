import { useCallback, useSyncExternalStore } from "react";
import { subscribeEditorialPageElements } from "../services/editorialElementsService";

const cache = new Map();
const channels = new Map();
const EMPTY_ELEMENTS = [];

function getKey(context) {
  return `${context.projectId}.${context.documentId}.${context.pageId}`;
}

function joinChannel(context, listener) {
  const key = getKey(context);
  let channel = channels.get(key);
  if (!channel) {
    channel = { listeners: new Set(), unsubscribe: null };
    channel.unsubscribe = subscribeEditorialPageElements(
      context,
      (elements) => {
        cache.set(key, elements);
        channel.listeners.forEach((nextListener) => nextListener(elements));
      },
      () => {}
    );
    channels.set(key, channel);
  }
  channel.listeners.add(listener);
  if (cache.has(key)) listener(cache.get(key));
  return () => {
    channel.listeners.delete(listener);
    if (channel.listeners.size === 0) {
      channel.unsubscribe?.();
      channels.delete(key);
    }
  };
}

export function useEditorialPagePreviewElements(context, enabled = true) {
  const key = getKey(context);
  const { projectId, documentId, pageId } = context;
  const subscribe = useCallback((listener) => {
    if (!enabled || !pageId) return () => {};
    return joinChannel({ projectId, documentId, pageId }, listener);
  }, [documentId, enabled, pageId, projectId]);
  const getSnapshot = useCallback(() => cache.get(key) || EMPTY_ELEMENTS, [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function primeEditorialPagePreview(context, elements) {
  const key = getKey(context);
  cache.set(key, elements);
  channels.get(key)?.listeners.forEach((listener) => listener(elements));
}
