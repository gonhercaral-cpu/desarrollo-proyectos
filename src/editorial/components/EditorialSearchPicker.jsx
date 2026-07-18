import { useMemo, useState } from "react";

// Estabilización — selector/combobox buscable reutilizable. Reemplaza los
// `<select>` nativos (ilegibles en modo oscuro). Muestra nombre principal +
// subtítulo, con búsqueda acento-insensible, estados loading/vacío/error,
// selección visible, teclado y foco. Un único componente para Proyectos,
// responsables, exportaciones y carpetas Drive.
function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

export default function EditorialSearchPicker({
  items = [],
  getId,
  getLabel,
  getDescription,
  searchText,
  selectedId = "",
  onSelect,
  loading = false,
  error = "",
  emptyMessage = "Sin resultados.",
  placeholder = "Buscar…",
  ariaLabel = "Buscar",
}) {
  const [search, setSearch] = useState("");
  const term = normalize(search);
  const describe = getDescription || (() => "");
  const textOf = searchText || getLabel;

  const filtered = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    if (!term) return list;
    return list.filter((item) => normalize(textOf(item)).includes(term));
  }, [items, term, textOf]);

  return (
    <div className="editorial-search-picker">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {error && <p className="editorial-notice warning">{error}</p>}
      <ul className="editorial-search-options" role="listbox" aria-label={ariaLabel}>
        {loading ? (
          <li className="editorial-hint">Cargando…</li>
        ) : filtered.length === 0 ? (
          <li className="editorial-hint">{items.length === 0 ? emptyMessage : "Sin coincidencias."}</li>
        ) : (
          filtered.map((item) => {
            const id = getId(item);
            const description = describe(item);
            return (
              <li key={id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedId === id}
                  className={selectedId === id ? "selected" : ""}
                  onClick={() => onSelect(id, item)}
                >
                  <strong>{getLabel(item)}</strong>
                  {description && <small>{description}</small>}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
