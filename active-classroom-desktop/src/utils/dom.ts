export function queryElement<T extends HTMLElement = HTMLElement>(id: string): T { const element = document.getElementById(id); if (!element) throw new Error(`No se encontró #${id}.`); return element as T; }
export function querySelect(id: string): HTMLSelectElement { return queryElement<HTMLSelectElement>(id); }
export function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
