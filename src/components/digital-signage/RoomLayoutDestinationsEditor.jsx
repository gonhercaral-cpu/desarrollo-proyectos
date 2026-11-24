import { useMemo } from "react";

export default function RoomLayoutDestinationsEditor({
  layout,
  devices = [],
  allPlanteles = [],
  onChange,
  onConvertToIndependent,
  disabled = false,
}) {
  const isIndependent = Boolean(layout && Array.isArray(layout.destinations));
  const destinations = useMemo(() => {
    return isIndependent ? layout.destinations || [] : [];
  }, [isIndependent, layout]);

  const availablePlanteles = useMemo(() => {
    if (!isIndependent) return [];
    const currentPlanteles = new Set(destinations.map((d) => d.plantel));
    return allPlanteles.filter((p) => p && !currentPlanteles.has(p));
  }, [isIndependent, destinations, allPlanteles]);

  function handleAddBranch(plantelToAdd) {
    if (!plantelToAdd || disabled || !isIndependent) return;
    if (destinations.length >= 20) {
      alert("Se ha alcanzado el límite máximo de 20 sucursales destino por acomodo.");
      return;
    }
    const next = [...destinations, { plantel: plantelToAdd, deviceIds: [] }];
    onChange(next);
  }

  function handleRemoveBranch(plantelToRemove) {
    if (disabled || !isIndependent) return;
    const next = destinations.filter((d) => d.plantel !== plantelToRemove);
    onChange(next);
  }

  function handleToggleAllScreens(plantel, checked) {
    if (disabled || !isIndependent) return;
    const next = destinations.map((d) => {
      if (d.plantel !== plantel) return d;
      if (checked) {
        return { ...d, deviceIds: [] };
      }
      const branchDevices = devices.filter((dev) => dev.plantel === plantel && dev.active !== false);
      const initialIds = branchDevices.map((dev) => dev.id || dev.deviceToken);
      if (!initialIds.length) { window.alert("No hay pantallas activas para seleccionar. Conserva todas las pantallas futuras o quita esta sucursal."); return d; }
      return { ...d, deviceIds: initialIds.length > 0 ? initialIds : [] };
    });
    onChange(next);
  }

  function handleToggleDevice(plantel, deviceId, checked) {
    if (disabled || !isIndependent) return;
    const next = destinations.map((d) => {
      if (d.plantel !== plantel) return d;
      const currentIds = Array.isArray(d.deviceIds) ? d.deviceIds : [];
      let nextIds;
      if (checked) {
        nextIds = currentIds.includes(deviceId) ? currentIds : [...currentIds, deviceId];
      } else {
        nextIds = currentIds.filter((id) => id !== deviceId);
        if (nextIds.length === 0) {
          alert("Conserva al menos una pantalla seleccionada o activa «Todas las pantallas» para esta sucursal.");
          return d;
        }
      }
      return { ...d, deviceIds: nextIds };
    });
    onChange(next);
  }

  if (!isIndependent) {
    return (
      <div className="signage-rooms-destinations-editor legacy">
        <div className="signage-rooms-destinations-legacy-banner">
          <div className="signage-rooms-destinations-legacy-info">
            <div className="signage-rooms-header-badge-row">
              <strong>Destinos de Proyección:</strong>
              <span className="signage-rooms-badge is-legacy">Configuración anterior</span>
            </div>
            <p>
              Este acomodo está vinculado exclusivamente al plantel <strong>{layout?.plantel || "Sin definir"}</strong>.
              Para proyectarlo en múltiples sucursales o pantallas específicas (arriba/abajo), conviértelo a acomodo independiente de biblioteca global.
            </p>
          </div>
          {typeof onConvertToIndependent === "function" && (
            <button
              type="button"
              className="visual-primary-button compact"
              onClick={onConvertToIndependent}
              disabled={disabled}
            >
              Convertir a biblioteca global
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="signage-rooms-destinations-editor">
      <div className="signage-rooms-destinations-head">
        <div>
          <div className="signage-rooms-header-badge-row">
            <strong>Destinos de Proyección (Pantallas Receptoras)</strong>
            <span className="signage-rooms-badge is-independent">Biblioteca Global</span>
            {destinations.length === 0 && (
              <span className="signage-rooms-badge is-pending">Sin receptores</span>
            )}
          </div>
          <p className="signage-rooms-hint-text">
            Elige qué sucursales y pantallas proyectarán este acomodo. Puedes asignar pantallas específicas
            (planta alta / baja) o todas las pantallas de cada plantel.
          </p>
        </div>
      </div>

      {destinations.length === 0 && (
        <div className="signage-rooms-destinations-empty-notice" role="alert">
          <p>
            <strong>Borrador sin receptores:</strong> Este acomodo se guardará en la biblioteca global sin emitirse a ninguna pantalla.
            Para publicarlo en pantallas, agrega al menos una sucursal destino.
          </p>
        </div>
      )}

      <div className="signage-rooms-destinations-branches-list">
        {destinations.map((dest) => {
          const branchDevices = devices.filter((d) => d.plantel === dest.plantel);
          const isAllScreens = !dest.deviceIds || dest.deviceIds.length === 0;

          return (
            <div key={dest.plantel} className="signage-rooms-destinations-branch-card">
              <div className="signage-rooms-destinations-branch-header">
                <div className="signage-rooms-destinations-branch-title">
                  <h4>{dest.plantel}</h4>
                  <span className="signage-rooms-badge is-tv">
                    {isAllScreens
                      ? "Todas las pantallas"
                      : `${dest.deviceIds.length} pantalla(s) seleccionada(s)`}
                  </span>
                </div>
                <button
                  type="button"
                  className="visual-outline-button compact danger"
                  onClick={() => handleRemoveBranch(dest.plantel)}
                  disabled={disabled}
                  title={`Quitar ${dest.plantel} de los destinos`}
                >
                  Quitar sucursal
                </button>
              </div>

              <div className="signage-rooms-destinations-branch-controls">
                <label className="signage-rooms-checkbox-label">
                  <input
                    type="checkbox"
                    checked={isAllScreens}
                    onChange={(e) => handleToggleAllScreens(dest.plantel, e.target.checked)}
                    disabled={disabled}
                  />
                  <span>Todas las pantallas activas y futuras de {dest.plantel}</span>
                </label>

                {!isAllScreens && (
                  <div className="signage-rooms-destinations-devices-picker">
                    <span className="signage-rooms-days-label">
                      Selecciona pantallas específicas de {dest.plantel}:
                    </span>
                    {branchDevices.length === 0 ? (
                      <p className="signage-rooms-subtext">
                        No hay pantallas registradas actualmente en {dest.plantel}.
                      </p>
                    ) : (
                      <div className="signage-rooms-device-checkboxes-grid">
                        {branchDevices.map((dev) => {
                          const devId = dev.id || dev.deviceToken;
                          const isChecked = dest.deviceIds.includes(devId);
                          const locationInfo = dev.location || dev.stableId;
                          return (
                            <label key={devId} className="signage-rooms-checkbox-label compact">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) =>
                                  handleToggleDevice(dest.plantel, devId, e.target.checked)
                                }
                                disabled={disabled}
                              />
                              <div className="signage-rooms-device-label-text">
                                <span className="signage-rooms-device-name">
                                  {dev.name || dev.deviceToken || "Pantalla"}
                                </span>
                                {locationInfo && (
                                  <span className="signage-rooms-device-location-badge">
                                    {locationInfo}
                                  </span>
                                )}
                                {dev.active === false && (
                                  <span className="signage-rooms-subtext">(Inactiva)</span>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {availablePlanteles.length > 0 && (
        <div className="signage-rooms-destinations-add-row">
          <label className="signage-rooms-field" style={{ flex: 1, maxWidth: 320 }}>
            Agregar sucursal destino:
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  handleAddBranch(e.target.value);
                  e.target.value = "";
                }
              }}
              disabled={disabled}
            >
              <option value="" disabled>
                -- Seleccionar sucursal --
              </option>
              {availablePlanteles.map((p) => (
                <option key={p} value={p}>
                  + {p}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
