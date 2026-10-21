const bindings = new WeakMap<Element, Map<string, EventListener>>();
// Stable DOM views replace their handler, not their element or listener list.
export function bindStableEvent(element: Element | null, event: string, listener: EventListener): void {
  if (!element) return;
  const handlers = bindings.get(element) || new Map<string, EventListener>();
  const previous = handlers.get(event); if (previous) element.removeEventListener(event, previous);
  handlers.set(event, listener); bindings.set(element, handlers); element.addEventListener(event, listener);
}
