import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  loadDashboardPreference,
  loadExecutiveDashboard,
  saveDashboardPreference,
} from "../services/executiveDashboardService";
import {
  createWidgetFromCatalog,
  getDefaultWidget,
  getDefaultDashboardLayout,
  normalizeDashboardLayout,
} from "../components/executive-dashboard/dashboardCatalog";

const LOCAL_KEY_PREFIX = "dp.executiveDashboard.layout.";

export function useExecutiveDashboard() {
  const { firebaseUser } = useAuth();
  const uid = firebaseUser?.uid || "";
  const [data, setData] = useState(null);
  const [layout, setLayout] = useState(getDefaultDashboardLayout);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const preferencesReady = useRef(false);

  const refresh = useCallback(async ({ initial = false } = {}) => {
    if (!uid) return;
    initial ? setLoading(true) : setRefreshing(true);
    setError("");
    try {
      const next = await loadExecutiveDashboard(uid);
      setData(next);
      if (next.partial) {
        setError(`Algunas fuentes no están disponibles: ${next.unavailableSources.join(", ")}.`);
      }
    } catch (loadError) {
      console.error("No se pudo cargar el dashboard ejecutivo:", loadError);
      setError("No se pudo cargar el dashboard ejecutivo. Revisa conexión y permisos.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    let active = true;
    preferencesReady.current = false;

    Promise.allSettled([loadDashboardPreference(uid), loadExecutiveDashboard(uid)]).then(([preferenceResult, dataResult]) => {
      if (!active) return;
      if (preferenceResult.status === "fulfilled") {
        setLayout(preferenceResult.value);
        localStorage.setItem(`${LOCAL_KEY_PREFIX}${uid}`, JSON.stringify(preferenceResult.value));
      } else {
        const local = readLocalLayout(uid);
        if (local) setLayout(local);
      }
      preferencesReady.current = true;

      if (dataResult.status === "fulfilled") {
        setData(dataResult.value);
        if (dataResult.value.partial) {
          setError(`Algunas fuentes no están disponibles: ${dataResult.value.unavailableSources.join(", ")}.`);
        }
      } else {
        console.error("No se pudo cargar el dashboard ejecutivo:", dataResult.reason);
        setError("No se pudo cargar el dashboard ejecutivo. Revisa conexión y permisos.");
      }
      setLoading(false);
    });

    return () => { active = false; };
  }, [uid]);

  useEffect(() => {
    if (!uid || !preferencesReady.current) return undefined;
    localStorage.setItem(`${LOCAL_KEY_PREFIX}${uid}`, JSON.stringify(layout));
    setSaveState("saving");
    const timeout = window.setTimeout(async () => {
      try {
        await saveDashboardPreference(uid, layout);
        setSaveState("saved");
      } catch (saveError) {
        console.error("No se pudo guardar el diseño del dashboard:", saveError);
        setSaveState("local");
      }
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [layout, uid]);

  function updateWidget(id, patch) {
    setLayout((current) => normalizeDashboardLayout(current.map((widget) => widget.id === id ? {
      ...widget,
      ...patch,
      visible: typeof patch.visible === "boolean" ? patch.visible : widget.visible,
      hidden: typeof patch.visible === "boolean" ? !patch.visible : widget.hidden,
      filters: patch.filters ? { ...widget.filters, ...patch.filters } : widget.filters,
      metrics: Array.isArray(patch.metrics) ? [...patch.metrics] : widget.metrics,
      settings: patch.settings ? { ...widget.settings, ...patch.settings } : widget.settings,
    } : widget)));
  }

  function addWidget(type) {
    setLayout((current) => normalizeDashboardLayout([
      ...current,
      createWidgetFromCatalog(type, `${Date.now()}-${current.length}`, current),
    ]));
  }

  function removeWidget(id) {
    setLayout((current) => current.filter((widget) => widget.id !== id));
  }

  function commitLayout(nextLayout) {
    setLayout(normalizeDashboardLayout(nextLayout));
  }

  function restoreWidget(id) {
    setLayout((current) => normalizeDashboardLayout(current.map((widget) => {
      if (widget.id !== id) return widget;
      const restored = getDefaultWidget(widget);
      return { ...restored, x: widget.x, y: widget.y, id: widget.id };
    })));
  }

  function restoreDefault() {
    setLayout(getDefaultDashboardLayout());
  }

  return {
    data,
    layout: normalizeDashboardLayout(layout),
    loading,
    refreshing,
    error,
    saveState,
    refresh,
    updateWidget,
    addWidget,
    removeWidget,
    commitLayout,
    restoreWidget,
    restoreDefault,
  };
}

function readLocalLayout(uid) {
  try {
    const raw = localStorage.getItem(`${LOCAL_KEY_PREFIX}${uid}`);
    return raw ? normalizeDashboardLayout(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
