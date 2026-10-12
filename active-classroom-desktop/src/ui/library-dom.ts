// Preserve card, thumbnail and control identity while progress/catalog changes.
// Rendering the markup does not detach the existing grid or its unchanged cards.
export function reconcileLibrary(root: HTMLElement, markup: string, contentsOnly = false): void {
  const HTMLElement = root.ownerDocument.defaultView!.HTMLElement;
  const template = root.ownerDocument.createElement("template"); template.innerHTML = markup;
  const key = (node: Node): string => node instanceof HTMLElement ? node.dataset.unitCard || (node.dataset.level !== undefined ? `level:${node.dataset.level}` : "") : "";
  function patch(parent: Node, desired: Node): void {
    const old = [...parent.childNodes]; const keyed = new Map(old.map(node => [key(node), node]).filter(([value]) => value) as [string, Node][]);
    let cursor = parent.firstChild;
    for (const target of [...desired.childNodes]) {
      const identity = key(target);
      let current = identity ? keyed.get(identity) : cursor && !key(cursor) ? cursor : undefined;
      if (!current || current.nodeType !== target.nodeType || current.nodeName !== target.nodeName) current = target.cloneNode(true);
      if (current !== cursor) parent.insertBefore(current, cursor);
      if (current instanceof HTMLElement && target instanceof HTMLElement) {
        for (const attribute of [...current.attributes]) if (!target.hasAttribute(attribute.name) && !(attribute.name === "open" && current.tagName === "DETAILS")) current.removeAttribute(attribute.name);
        for (const attribute of [...target.attributes]) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
        if (current.matches(".unit-thumbnail") && current.querySelector(".unit-cover-image")) {
          const menu = current.querySelector(".unit-menu"); const wanted = target.querySelector(".unit-menu");
          if (menu && wanted) patch(menu, wanted);
        } else patch(current, target);
      } else if (current.nodeValue !== target.nodeValue) current.nodeValue = target.nodeValue;
      cursor = current.nextSibling;
    }
    while (cursor) { const next = cursor.nextSibling; parent.removeChild(cursor); cursor = next; }
  }
  patch(root, contentsOnly ? template.content.firstElementChild! : template.content);
}
