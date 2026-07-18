import { useEffect, useRef, useState } from "react";

// Estabilización — barra de menús funcional. Reutiliza los mismos handlers que
// la toolbar y los atajos (no duplica lógica). Ningún control queda activo sin
// comportamiento: cada ítem ejecuta una acción real o se muestra deshabilitado.
export default function EditorialMenuBar({ menus }) {
  const [openMenu, setOpenMenu] = useState("");
  const barRef = useRef(null);

  useEffect(() => {
    if (!openMenu) return undefined;
    const onDown = (event) => { if (barRef.current && !barRef.current.contains(event.target)) setOpenMenu(""); };
    const onKey = (event) => { if (event.key === "Escape") setOpenMenu(""); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [openMenu]);

  return (
    <div className="editorial-editor-menubar" role="menubar" aria-label="Menú editorial" ref={barRef}>
      {menus.map((menu) => (
        <div className={`editorial-menu ${openMenu === menu.label ? "open" : ""}`} key={menu.label}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={openMenu === menu.label}
            onClick={() => setOpenMenu((current) => (current === menu.label ? "" : menu.label))}
          >
            {menu.label}
          </button>
          {openMenu === menu.label && (
            <div className="editorial-menu-dropdown" role="menu" aria-label={menu.label}>
              {menu.items.filter((item) => item.separator || item.visible !== false).map((item, index) =>
                item.separator ? (
                  <span className="editorial-menu-separator" key={`sep-${index}`} />
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    key={item.id || item.label}
                    aria-disabled={item.enabled === false}
                    disabled={item.enabled === false}
                    className={item.active ? "active" : ""}
                    title={item.enabled === false && item.hint ? item.hint : undefined}
                    onClick={() => {
                      if (item.enabled === false || typeof item.execute !== "function") return;
                      setOpenMenu("");
                      try { item.execute(); }
                      catch (error) { console.error(`Editorial: comando "${item.id || item.label}" falló`, error); }
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <kbd>{item.shortcut}</kbd>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
