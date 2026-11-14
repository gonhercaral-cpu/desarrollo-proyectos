import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  DEFAULT_ROOM_TEMPLATE,
  createRoomId,
  ROOM_BLOCK_PRESETS,
  createRoomLayoutDraft,
  normalizeRoomLayout,
  normalizeRoomTemplate,
  validateRoomLayout,
  normalizeRoomConfig,
  validateRoomConfig,
  getRoomLayoutWarnings,
  getRoomLayoutPublicationState,
  formatRoomClassTime,
  getRoomDayLabel,
} from "../../utils/digitalSignage/roomLayouts";

import {
  subscribeRoomAdministration,
  saveRoomConfig,
  saveRoomLayout,
  saveRoomTemplate,
  publishRoomLayout,
  unpublishRoomLayout,
  uploadRoomTemplateImage,
} from "../../services/digital-signage/roomLayoutsService";

import RoomLayoutDisplay from "./RoomLayoutDisplay";
import RoomLayoutTemplateEditor from "./RoomLayoutTemplateEditor";

const WEEKDAY_NAMES = [
  { value: 1, label: "Lunes", short: "L" },
  { value: 2, label: "Martes", short: "M" },
  { value: 3, label: "Miércoles", short: "M" },
  { value: 4, label: "Jueves", short: "J" },
  { value: 5, label: "Viernes", short: "V" },
  { value: 6, label: "Sábado", short: "S" },
  { value: 0, label: "Domingo", short: "D" },
];

const IANA_TIMEZONES = [
  "America/Tijuana",
  "America/Hermosillo",
  "America/Mazatlan",
  "America/Mexico_City",
  "America/Monterrey",
  "America/Cancun",
];

export default function SignageRoomLayoutsPanel({
  profile,
  devices = [],
  planteles = [],
  onLeaveGuardChange,
}) {
  const [adminData, setAdminData] = useState({ configs: [], layouts: [], templates: [] });
  const [, setLoading] = useState(true);
  const [apiError, setApiError] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);

  const allPlanteles = useMemo(() => {
    const fromProps = Array.isArray(planteles) ? planteles : [];
    const fromDevs = (devices || []).map((d) => d.plantel).filter(Boolean);
    const fromSaved = [...adminData.configs, ...adminData.layouts].map((item) => item.plantel).filter(Boolean);
    const combined = Array.from(new Set([...fromProps, ...fromDevs, ...fromSaved]));
    return combined.length > 0 ? combined : ["Tijuana"];
  }, [planteles, devices, adminData.configs, adminData.layouts]);

  const [selectedPlantel, setSelectedPlantel] = useState(() => {
    if (Array.isArray(planteles) && planteles.length > 0) return planteles[0];
    if (Array.isArray(devices) && devices[0]?.plantel) return devices[0].plantel;
    return "Tijuana";
  });

  const [draft, setDraft] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [roomsDirty, setRoomsDirty] = useState(false);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savingRoomsConfig, setSavingRoomsConfig] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [showRoomsManager, setShowRoomsManager] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);

  const [copyTargetPlantel, setCopyTargetPlantel] = useState("");
  const [copyClassDays, setCopyClassDays] = useState([1, 2, 3, 4, 5]);
  const [copyClassStart, setCopyClassStart] = useState("09:00");
  const [copyClassEnd, setCopyClassEnd] = useState("10:00");
  const [copyName, setCopyName] = useState("");
  const [copyStartTime, setCopyStartTime] = useState("08:50");
  const [copyEndTime, setCopyEndTime] = useState("09:15");

  const [localRoomsList, setLocalRoomsList] = useState([]);
  const [localTimezone, setLocalTimezone] = useState("America/Tijuana");

  const [previewNowMillis, setPreviewNowMillis] = useState(() => Date.now());

  const layoutRevisionRef = useRef(0);
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const isDirtyRef = useRef(isDirty);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  const roomsDirtyRef = useRef(roomsDirty);
  useEffect(() => { roomsDirtyRef.current = roomsDirty; }, [roomsDirty]);
  const templateDirtyRef = useRef(templateDirty);
  useEffect(() => { templateDirtyRef.current = templateDirty; }, [templateDirty]);

  const editorOpenerRef = useRef(null);
  const copyOpenerRef = useRef(null);
  const editorModalRef = useRef(null);
  const copyModalRef = useRef(null);

  const anyDirty = isDirty || roomsDirty || templateDirty;
  const busy = saving || publishing || savingRoomsConfig || savingTemplate || uploadingTemplate;
  const adminDataRef = useRef(adminData);
  useEffect(() => { adminDataRef.current = adminData; }, [adminData]);

  useEffect(() => {
    if (!onLeaveGuardChange) return;
    onLeaveGuardChange(() => {
      if (busy) return false;
      if (!isDirtyRef.current && !roomsDirtyRef.current && !templateDirtyRef.current) return true;
      return window.confirm("Tienes cambios sin guardar en acomodos, catálogo o plantilla. ¿Deseas descartarlos para salir?");
    });
    return () => onLeaveGuardChange(null);
  }, [onLeaveGuardChange, busy, anyDirty]);

  useEffect(() => {
    if (allPlanteles.includes(selectedPlantel) || anyDirty || busy) return;
    let cancelled = false;
    // Planteles can arrive after the authenticated profile/devices finish loading.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setSelectedPlantel(allPlanteles[0]);
      setDraft(null);
      draftRef.current = null;
    });
    return () => { cancelled = true; };
  }, [allPlanteles, selectedPlantel, anyDirty, busy]);

  useEffect(() => {
    const timer = setInterval(() => {
      setPreviewNowMillis(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleBeforeUnload(e) {
      if (isDirtyRef.current || roomsDirtyRef.current || templateDirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const createDefaultDraft = useCallback(
    (plantelName, existingRooms = null) => {
      const cfg = adminDataRef.current.configs.find((c) => c.plantel === plantelName);
      const roomsToUse =
        existingRooms ||
        cfg?.rooms || [
          { id: "r1", name: "Salón 1", active: true },
          { id: "r2", name: "Salón 2", active: true },
          { id: "r3", name: "Salón 3", active: true },
          { id: "r4", name: "Salón 4", active: true },
        ];

      if (typeof createRoomLayoutDraft === "function") {
        try {
          const result = createRoomLayoutDraft({
            plantel: plantelName,
            timezone: cfg?.timezone || "America/Tijuana",
            rooms: roomsToUse,
          });
          if (result) return result;
        } catch {
          // fallback below
        }
      }

      return {
        name: "Acomodo de Salones",
        plantel: plantelName,
        timezone: cfg?.timezone || "America/Tijuana",
        classDays: [1, 2, 3, 4, 5],
        classStart: "09:00",
        classEnd: "10:00",
        assignments: roomsToUse.map((r, i) => ({
          id: createRoomId("assignment"),
          roomId: r.id,
          roomName: r.name || `Salón ${i + 1}`,
          teacher: "",
          group: "",
          active: r.active !== false,
        })),
        templateId: "",
        displayRules: [
          {
            id: createRoomId("rule"),
            daysOfWeek: [1, 2, 3, 4, 5],
            dates: [],
            startTime: "08:50",
            endTime: "09:15",
            deviceIds: [],
            active: true,
            priority: 0,
          },
        ],
        active: true,
      };
    },
    []
  );

  useEffect(() => {
    const unsubscribe = subscribeRoomAdministration(
      (data) => {
        const configs = Array.isArray(data?.configs) ? data.configs : [];
        const layouts = Array.isArray(data?.layouts) ? data.layouts : [];
        const templates = Array.isArray(data?.templates) ? data.templates : [];

        adminDataRef.current = { configs, layouts, templates };
        setAdminData({ configs, layouts, templates });
        setLoading(false);
        setApiError(null);

        if (!draftRef.current) {
          const currentPlantelLayouts = layouts.filter((l) => l.plantel === selectedPlantel);
          if (currentPlantelLayouts.length > 0) {
            const initialDraft = normalizeRoomLayout
              ? normalizeRoomLayout(currentPlantelLayouts[0])
              : currentPlantelLayouts[0];
            setDraft(initialDraft);
            draftRef.current = initialDraft;
          } else {
            const def = createDefaultDraft(selectedPlantel);
            setDraft(def);
            draftRef.current = def;
          }
          setIsDirty(false);
        }

        if (!roomsDirtyRef.current) {
          const currentCfg = configs.find((c) => c.plantel === selectedPlantel);
          if (currentCfg?.rooms) {
            setLocalRoomsList(currentCfg.rooms);
            setLocalTimezone(currentCfg.timezone || "America/Tijuana");
          } else {
            setLocalRoomsList([
              { id: "r1", name: "Salón 1", active: true },
              { id: "r2", name: "Salón 2", active: true },
              { id: "r3", name: "Salón 3", active: true },
              { id: "r4", name: "Salón 4", active: true },
            ]);
            setLocalTimezone("America/Tijuana");
          }
        }
      },
      (err) => {
        setApiError(err?.message || "Error al conectar con la administración de salones.");
        setLoading(false);
      }
    );
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [selectedPlantel, createDefaultDraft]);

  const activeConfig = useMemo(() => {
    return adminData.configs.find((c) => c.plantel === selectedPlantel) || null;
  }, [adminData.configs, selectedPlantel]);

  const plantelLayouts = useMemo(() => {
    return adminData.layouts.filter((l) => l.plantel === selectedPlantel);
  }, [adminData.layouts, selectedPlantel]);

  const devicesInPlantel = useMemo(() => {
    return devices.filter((d) => d.plantel === selectedPlantel);
  }, [devices, selectedPlantel]);

  const rawStoredLayout = useMemo(() => {
    if (!draft?.id) return null;
    return adminData.layouts.find((l) => l.id === draft.id) || null;
  }, [adminData.layouts, draft]);

  const currentTemplate = useMemo(() => {
    if (!draft?.templateId) return DEFAULT_ROOM_TEMPLATE;
    return (
      adminData.templates.find((t) => t.id === draft.templateId) || DEFAULT_ROOM_TEMPLATE
    );
  }, [draft, adminData.templates]);

  const publicationState = useMemo(() => {
    const layoutWithMeta = {
      ...(draft || {}),
      publishedSnapshot: rawStoredLayout?.publishedSnapshot,
      publishedAt: rawStoredLayout?.publishedAt,
    };

    if (typeof getRoomLayoutPublicationState === "function") {
      try {
        const state = getRoomLayoutPublicationState(layoutWithMeta, currentTemplate);
        if (typeof state === "string") {
          return { isPublished: state === "published" || state === "pending", isPending: state === "pending" };
        }
        if (state && typeof state === "object") {
          return {
            isPublished: Boolean(state.isPublished ?? state.published),
            isPending: Boolean(state.isPending ?? state.hasPendingChanges ?? state.pending),
          };
        }
        if (typeof state === "boolean") {
          return {
            isPublished: state,
            isPending: state && isDirty,
          };
        }
      } catch {
        // fallback below
      }
    }

    const isPub = Boolean(rawStoredLayout?.publishedSnapshot || rawStoredLayout?.publishedAt);
    return {
      isPublished: isPub,
      isPending: isPub && isDirty,
    };
  }, [draft, rawStoredLayout, currentTemplate, isDirty]);

  const warnings = useMemo(() => {
    if (!draft || typeof getRoomLayoutWarnings !== "function") return [];
    try {
      return getRoomLayoutWarnings(draft, adminData.layouts, devices);
    } catch {
      return [];
    }
  }, [draft, adminData.layouts, devices]);

  const teacherSuggestions = useMemo(() => {
    const set = new Set();
    (activeConfig?.teacherNames || []).forEach((t) => {
      if (t && typeof t === "string") set.add(t.trim());
    });
    adminData.layouts.forEach((l) => {
      (l.assignments || []).forEach((a) => {
        if (a?.teacher && typeof a.teacher === "string" && a.teacher.trim()) {
          set.add(a.teacher.trim());
        }
      });
    });
    return Array.from(set).sort();
  }, [activeConfig, adminData.layouts]);

  function confirmDiscard(actionLabel = "continuar") {
    if (!anyDirty) return true;
    const pendingItems = [
      isDirty ? "acomodo de salones" : "",
      roomsDirty ? "catálogo de salones" : "",
      templateDirty ? "plantilla visual" : "",
    ]
      .filter(Boolean)
      .join(", ");
    return window.confirm(
      `Tienes cambios pendientes sin guardar en: ${pendingItems}. ¿Deseas descartarlos para ${actionLabel}?`
    );
  }

  function handlePlantelChange(newPlantel) {
    if (busy) return;
    if (newPlantel === selectedPlantel) return;
    if (!confirmDiscard(`cambiar a ${newPlantel}`)) return;

    setSelectedPlantel(newPlantel);
    setCopyTargetPlantel(newPlantel);

    const layouts = adminData.layouts.filter((l) => l.plantel === newPlantel);
    if (layouts.length > 0) {
      const normalized = normalizeRoomLayout ? normalizeRoomLayout(layouts[0]) : layouts[0];
      setDraft(normalized);
      draftRef.current = normalized;
    } else {
      const fresh = createDefaultDraft(newPlantel);
      setDraft(fresh);
      draftRef.current = fresh;
    }
    setIsDirty(false);
    isDirtyRef.current = false;

    const targetCfg = adminData.configs.find((c) => c.plantel === newPlantel);
    if (targetCfg?.rooms) {
      setLocalRoomsList(targetCfg.rooms);
      setLocalTimezone(targetCfg.timezone || "America/Tijuana");
    } else {
      setLocalRoomsList([
        { id: "r1", name: "Salón 1", active: true },
        { id: "r2", name: "Salón 2", active: true },
        { id: "r3", name: "Salón 3", active: true },
        { id: "r4", name: "Salón 4", active: true },
      ]);
      setLocalTimezone("America/Tijuana");
    }
    setRoomsDirty(false);
    roomsDirtyRef.current = false;

    setIsEditorOpen(false);
    setTemplateDirty(false);
    templateDirtyRef.current = false;
  }

  function handleSelectLayout(layout) {
    if (busy) return;
    if (draft?.id === layout.id) return;
    if (isDirty && !window.confirm("¿Descartar los cambios del acomodo para abrir otro?")) return;
    const normalized = normalizeRoomLayout ? normalizeRoomLayout(layout) : layout;
    setDraft(normalized);
    draftRef.current = normalized;
    setIsDirty(false);
    isDirtyRef.current = false;
    setIsEditorOpen(false);
    setTemplateDirty(false);
    templateDirtyRef.current = false;
    setStatusMessage(null);
  }

  function handleNewDraft() {
    if (busy) return;
    if (isDirty && !window.confirm("¿Descartar los cambios del acomodo para crear uno nuevo?")) return;
    const fresh = createDefaultDraft(selectedPlantel, localRoomsList);
    setDraft(fresh);
    draftRef.current = fresh;
    setIsDirty(true);
    isDirtyRef.current = true;
    setIsEditorOpen(false);
    setTemplateDirty(false);
    templateDirtyRef.current = false;
    setStatusMessage({
      type: "success",
      text: "Nuevo borrador inicializado. Modifícalo y guárdalo cuando esté listo.",
    });
  }

  function updateDraft(partial) {
    layoutRevisionRef.current += 1;
    setDraft((prev) => {
      const next = { ...prev, ...partial };
      draftRef.current = next;
      return next;
    });
    setIsDirty(true);
    isDirtyRef.current = true;
  }

  function updateAssignment(index, field, value) {
    if (!draft || !draft.assignments) return;
    const next = [...draft.assignments];
    next[index] = { ...next[index], [field]: value };
    updateDraft({ assignments: next });
  }

  function addAssignment() {
    if (!draft) return;
    const next = [...(draft.assignments || [])];
    next.push({
      id: createRoomId("assignment"),
      roomName: `Salón ${next.length + 1}`,
      teacher: "",
      group: "",
      active: true,
    });
    updateDraft({ assignments: next });
  }

  function removeAssignment(index) {
    if (!draft || !draft.assignments) return;
    const next = draft.assignments.filter((_, i) => i !== index);
    updateDraft({ assignments: next });
  }

  function moveAssignment(index, direction) {
    if (!draft || !draft.assignments) return;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= draft.assignments.length) return;
    const copy = [...draft.assignments];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    updateDraft({ assignments: copy });
  }

  function toggleClassDay(dayNum) {
    if (!draft) return;
    const current = draft.classDays || [];
    const next = current.includes(dayNum)
      ? current.filter((d) => d !== dayNum)
      : [...current, dayNum].sort((a, b) => a - b);
    updateDraft({ classDays: next });
  }

  function applyPreset(preset) {
    updateDraft({
      classDays: preset.daysOfWeek || [1, 2, 3, 4, 5],
      classStart: preset.startTime || "09:00",
      classEnd: preset.endTime || "10:00",
      name: preset.label || draft.name,
    });
  }

  function updateDisplayRule(index, partial) {
    if (!draft || !draft.displayRules) return;
    const next = [...draft.displayRules];
    next[index] = { ...next[index], ...partial };
    updateDraft({ displayRules: next });
  }

  function addDisplayRule() {
    if (!draft) return;
    const next = [...(draft.displayRules || [])];
    next.push({
      id: createRoomId("rule"),
      daysOfWeek: draft.classDays || [1, 2, 3, 4, 5],
      dates: [],
      startTime: "08:50",
      endTime: "09:15",
      deviceIds: [],
      active: true,
      priority: 0,
    });
    updateDraft({ displayRules: next });
  }

  function removeDisplayRule(index) {
    if (!draft || !draft.displayRules) return;
    const next = draft.displayRules.filter((_, i) => i !== index);
    updateDraft({ displayRules: next });
  }

  async function handleSaveDraft(overrideDraft = null) {
    const currentDraft = overrideDraft || draftRef.current;
    if (!currentDraft) return null;
    setSaving(true);
    setStatusMessage(null);
    setApiError(null);
    const revAtStart = layoutRevisionRef.current;
    try {
      const payload = {
        ...currentDraft,
        plantel: currentDraft.plantel || selectedPlantel,
      };
      if (typeof validateRoomLayout === "function") {
        validateRoomLayout(payload);
      }
      const saved = await saveRoomLayout(payload, profile);
      if (layoutRevisionRef.current === revAtStart) {
        setDraft(saved);
        draftRef.current = saved;
        setIsDirty(false);
        isDirtyRef.current = false;
      }
      setStatusMessage({ type: "success", text: "Borrador guardado correctamente." });
      return saved;
    } catch (err) {
      setApiError(err?.message || "Error al guardar el borrador del acomodo.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!draft) return;
    const unassigned = (draft.assignments || []).filter((a) => a.active && !a.teacher?.trim());
    if (unassigned.length > 0) {
      const proceed = window.confirm(
        `Hay ${unassigned.length} salón(es) sin maestro asignado. ¿Deseas publicar de todas formas?`
      );
      if (!proceed) return;
    }

    setPublishing(true);
    setStatusMessage(null);
    setApiError(null);
    try {
      let publishDraft = draftRef.current;
      if (templateDirty && editingTemplate) {
        const templateSaved = await handleSaveTemplate(editingTemplate);
        if (!templateSaved) throw new Error("No se pudo guardar la plantilla antes de publicar.");
        publishDraft = { ...draftRef.current, templateId: templateSaved.id };
      }

      const saved = await handleSaveDraft(publishDraft);
      if (!saved || !saved.id) {
        throw new Error("No se pudo guardar el borrador previo a publicar.");
      }

      await publishRoomLayout(saved.id, profile);
      setStatusMessage({
        type: "success",
        text: "Acomodo publicado exitosamente en las pantallas receptoras.",
      });
    } catch (err) {
      setApiError(err?.message || "Error al publicar el acomodo.");
    } finally {
      setPublishing(false);
    }
  }

  async function handleUnpublish() {
    if (!draft?.id) return;
    if (!window.confirm("¿Deseas retirar este acomodo de las pantallas receptoras?")) return;

    setPublishing(true);
    setStatusMessage(null);
    setApiError(null);
    try {
      await unpublishRoomLayout(draft.id, profile);
      setStatusMessage({ type: "success", text: "Acomodo despublicado de las pantallas." });
    } catch (err) {
      setApiError(err?.message || "Error al despublicar.");
    } finally {
      setPublishing(false);
    }
  }

  function handleOpenCopyModal(e) {
    copyOpenerRef.current = e.currentTarget;
    setCopyTargetPlantel(selectedPlantel);
    setCopyClassDays(draft?.classDays || [1, 2, 3, 4, 5]);
    setCopyClassStart(draft?.classStart || "09:00");
    setCopyClassEnd(draft?.classEnd || "10:00");
    setCopyName(`${draft?.name || "Acomodo"} (Copia)`);
    setCopyStartTime(draft?.displayRules?.[0]?.startTime || "08:50");
    setCopyEndTime(draft?.displayRules?.[0]?.endTime || "09:15");
    setShowCopyModal(true);
  }

  function handleExecuteCopy() {
    if (!draft || busy) return;
    if (roomsDirty && !window.confirm("La copia cambiará el catálogo visible. ¿Descartar los cambios pendientes del catálogo?")) return;
    const targetCfg = adminData.configs.find((c) => c.plantel === copyTargetPlantel);
    const targetRooms = targetCfg?.rooms || [];

    const newAssignments = (draft.assignments || []).map((a) => {
      const matchedTargetRoom = targetRooms.find(
        (r) => r.name?.trim().toLowerCase() === a.roomName?.trim().toLowerCase()
      );
      return {
        ...a,
        id: createRoomId("assignment"),
        roomId: matchedTargetRoom ? matchedTargetRoom.id : copyTargetPlantel === selectedPlantel ? a.roomId : undefined,
      };
    });

    const newRules = (draft.displayRules || []).map((r, i) => ({
      ...r,
      id: createRoomId("rule"),
      daysOfWeek: copyClassDays,
      dates: [],
      startTime: i === 0 ? copyStartTime : r.startTime,
      endTime: i === 0 ? copyEndTime : r.endTime,
      deviceIds: [],
    }));

    const newDraft = {
      ...draft,
      id: createRoomId("layout"),
      name: copyName || `${draft.name} (Copia)`,
      plantel: copyTargetPlantel,
      timezone: targetCfg?.timezone || "America/Tijuana",
      classDays: copyClassDays,
      classStart: copyClassStart,
      classEnd: copyClassEnd,
      assignments: newAssignments,
      displayRules: newRules,
      publishedAt: null,
      publishedSnapshot: null,
      active: true,
    };

    setSelectedPlantel(copyTargetPlantel);
    setDraft(newDraft);
    draftRef.current = newDraft;
    setIsDirty(true);
    isDirtyRef.current = true;

    if (targetCfg?.rooms) {
      setLocalRoomsList(targetCfg.rooms);
      setLocalTimezone(targetCfg.timezone || "America/Tijuana");
    } else {
      setLocalRoomsList([
        { id: "r1", name: "Salón 1", active: true },
        { id: "r2", name: "Salón 2", active: true },
        { id: "r3", name: "Salón 3", active: true },
        { id: "r4", name: "Salón 4", active: true },
      ]);
      setLocalTimezone("America/Tijuana");
    }
    setRoomsDirty(false);
    roomsDirtyRef.current = false;

    setShowCopyModal(false);
    if (copyOpenerRef.current) {
      copyOpenerRef.current.focus();
    }
    setStatusMessage({
      type: "success",
      text: `Copia generada como nuevo borrador independiente para ${copyTargetPlantel}. Revisa y guarda cuando esté listo.`,
    });
  }

  async function handleSaveRoomsConfig() {
    setSavingRoomsConfig(true);
    setStatusMessage(null);
    setApiError(null);
    try {
      const rawPayload = {
        plantel: selectedPlantel,
        timezone: localTimezone || activeConfig?.timezone || "America/Tijuana",
        rooms: localRoomsList,
        teacherNames: activeConfig?.teacherNames || [],
      };
      const payload = typeof validateRoomConfig === "function"
        ? validateRoomConfig(rawPayload)
        : typeof normalizeRoomConfig === "function"
        ? normalizeRoomConfig(rawPayload)
        : rawPayload;

      await saveRoomConfig(payload, profile);
      setRoomsDirty(false);
      roomsDirtyRef.current = false;
      setStatusMessage({
        type: "success",
        text: `Catálogo de salones guardado para ${selectedPlantel}.`,
      });
    } catch (err) {
      setApiError(err?.message || "Error al guardar catálogo de salones.");
    } finally {
      setSavingRoomsConfig(false);
    }
  }

  function handleApplyRoomsToDraft() {
    if (!draft) return;
    const currentAssignments = Array.isArray(draft.assignments) ? draft.assignments : [];
    const matchedIndices = new Set();

    const updatedAssignments = localRoomsList.map((room) => {
      let matchIdx = currentAssignments.findIndex(
        (a, i) => !matchedIndices.has(i) && a.roomId && a.roomId === room.id
      );
      if (matchIdx < 0) {
        matchIdx = currentAssignments.findIndex(
          (a, i) => !matchedIndices.has(i) && a.id === room.id
        );
      }
      if (matchIdx < 0) {
        matchIdx = currentAssignments.findIndex(
          (a, i) =>
            !matchedIndices.has(i) &&
            a.roomName &&
            a.roomName.trim().toLowerCase() === room.name.trim().toLowerCase()
        );
      }

      if (matchIdx >= 0) {
        matchedIndices.add(matchIdx);
        const existing = currentAssignments[matchIdx];
        return {
          ...existing,
          roomId: room.id,
          roomName: room.name,
          active: room.active !== false,
        };
      }

      return {
        id: createRoomId("assignment"),
        roomId: room.id,
        roomName: room.name,
        teacher: "",
        group: "",
        active: room.active !== false,
      };
    });

    const unmatched = currentAssignments.filter((_, i) => !matchedIndices.has(i));
    const finalAssignments = [...updatedAssignments, ...unmatched];

    updateDraft({ assignments: finalAssignments });
    setStatusMessage({
      type: "success",
      text: `Salones del catálogo aplicados al borrador actual (${localRoomsList.length} sincronizados, ${unmatched.length} conservados).`,
    });
  }

  function handleOpenEditor(mode, e) {
    editorOpenerRef.current = e.currentTarget;
    if (mode === "new") {
      const freshTemplate = {
        id: "",
        name: "Nueva Plantilla",
        version: 1,
        backgroundColor: "#0b3265",
        backgroundUrl: "",
        columns: 2,
        rows: 4,
        elements: DEFAULT_ROOM_TEMPLATE?.elements ? [...DEFAULT_ROOM_TEMPLATE.elements] : [],
        active: true,
      };
      setEditingTemplate(freshTemplate);
    } else if (mode === "duplicate") {
      const dupTemplate = {
        ...currentTemplate,
        id: "",
        name: `${currentTemplate.name || "Plantilla"} (Copia)`,
      };
      setEditingTemplate(dupTemplate);
    } else {
      setEditingTemplate(currentTemplate);
    }
    setTemplateDirty(false);
    templateDirtyRef.current = false;
    setIsEditorOpen(true);
  }

  function handleCloseEditor() {
    if (busy) return;
    if (templateDirtyRef.current) {
      const discard = window.confirm(
        "Tienes cambios sin guardar en la plantilla visual. ¿Deseas descartarlos y cerrar?"
      );
      if (!discard) return;
    }
    setIsEditorOpen(false);
    setTemplateDirty(false);
    templateDirtyRef.current = false;
    if (editorOpenerRef.current) {
      editorOpenerRef.current.focus();
    }
  }

  async function handleSaveTemplate(templateData) {
    if (savingTemplate) return;
    setSavingTemplate(true);
    setStatusMessage(null);
    setApiError(null);
    try {
      const payload = normalizeRoomTemplate
        ? normalizeRoomTemplate(templateData)
        : templateData;
      const saved = await saveRoomTemplate(payload, profile);
      updateDraft({ templateId: saved.id });
      setEditingTemplate(saved);
      setTemplateDirty(false);
      templateDirtyRef.current = false;
      setIsEditorOpen(false);
      if (editorOpenerRef.current) {
        editorOpenerRef.current.focus();
      }
      setStatusMessage({ type: "success", text: "Plantilla guardada y asignada al acomodo." });
      return saved;
    } catch (err) {
      setApiError(err?.message || "Error al guardar la plantilla.");
      return null;
    } finally {
      setSavingTemplate(false);
    }
  }

  useEffect(() => {
    if (!isEditorOpen && !busy && editorOpenerRef.current) {
      editorOpenerRef.current.focus();
      editorOpenerRef.current = null;
    }
  }, [isEditorOpen, busy]);

  useEffect(() => {
    const modal = isEditorOpen ? editorModalRef.current : showCopyModal ? copyModalRef.current : null;
    modal?.querySelector("button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus();
  }, [isEditorOpen, showCopyModal]);

  function handleModalKeyDown(e, closeFn) {
    if (e.key === "Tab") {
      const modal = e.currentTarget;
      const controls = [...modal.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']")]
        .filter((element) => element.offsetParent !== null);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (first && e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (last && !e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
    if (e.key === "Escape" && !busy) {
      e.stopPropagation();
      closeFn();
    }
  }

  return (
    <div className="signage-rooms-container">
      <div inert={busy} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 18, width: "100%" }}>
      <datalist id="signage-rooms-teachers-datalist">
        {teacherSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <header className="signage-rooms-header">
        <div className="signage-rooms-header-title">
          <h2>Acomodo de Salones</h2>
          <p>Distribución de salones y maestros con aparición programada sobre pantallas receptoras.</p>
        </div>

        <div className="signage-rooms-header-actions">
          <label className="signage-rooms-plantel-selector">
            Sucursal / Plantel:
            <select
              value={selectedPlantel}
              onChange={(e) => handlePlantelChange(e.target.value)}
              disabled={saving || publishing}
            >
              {allPlanteles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className="signage-rooms-plantel-selector">
            Acomodo:
            <select
              value={draft?.id || ""}
              onChange={(e) => {
                const layoutId = e.target.value;
                if (!layoutId) return;
                if (layoutId === "__new__") {
                  handleNewDraft();
                  return;
                }
                const target = plantelLayouts.find((l) => l.id === layoutId);
                if (target) {
                  handleSelectLayout(target);
                }
              }}
              disabled={saving || publishing}
            >
              {!plantelLayouts.some((layout) => layout.id === draft?.id) && (
                <option value={draft?.id || ""}>Nuevo borrador sin guardar</option>
              )}
              {plantelLayouts.map((l) => {
                const timeStr = formatRoomClassTime
                  ? formatRoomClassTime(l)
                  : `${l.classStart || ""} – ${l.classEnd || ""}`;
                const dayStr = getRoomDayLabel ? getRoomDayLabel(l.classDays) : "";
                return (
                  <option key={l.id} value={l.id}>
                    {l.name || "Sin nombre"} {timeStr ? `(${timeStr})` : ""} {dayStr ? `— ${dayStr}` : ""}
                  </option>
                );
              })}
              <option value="__new__">+ Crear nuevo acomodo…</option>
            </select>
          </label>

          <button
            type="button"
            className="visual-outline-button"
            onClick={() => setShowRoomsManager(!showRoomsManager)}
          >
            {showRoomsManager ? "Cerrar salones" : "Administrar salones"}
          </button>

          <button
            type="button"
            className="visual-outline-button"
            onClick={handleNewDraft}
            disabled={saving || publishing}
          >
            + Nuevo acomodo
          </button>
        </div>
      </header>

      {apiError && <div className="signage-rooms-error-banner">{apiError}</div>}
      {statusMessage && (
        <div className={`signage-rooms-status-banner ${statusMessage.type}`}>
          {statusMessage.text}
        </div>
      )}

      {showRoomsManager && (
        <section className="signage-rooms-admin-box">
          <div className="signage-rooms-box-header">
            <h3>Catálogo de Salones para {selectedPlantel}</h3>
            <p>Configura las aulas y zona horaria disponibles en este plantel de forma independiente.</p>
          </div>

          <div className="signage-rooms-form-grid" style={{ marginTop: 12 }}>
            <label className="signage-rooms-field">
              Zona horaria IANA del plantel:
              <select
                value={localTimezone}
                onChange={(e) => {
                  setLocalTimezone(e.target.value);
                  updateDraft({ timezone: e.target.value });
                  setRoomsDirty(true);
                  roomsDirtyRef.current = true;
                }}
              >
                {IANA_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="signage-rooms-rooms-editor-grid">
            {localRoomsList.map((room, idx) => (
              <div className="signage-rooms-room-item" key={room.id || idx}>
                <input
                  type="checkbox"
                  checked={room.active !== false}
                  onChange={(e) => {
                    const next = [...localRoomsList];
                    next[idx] = { ...next[idx], active: e.target.checked };
                    setLocalRoomsList(next);
                    setRoomsDirty(true);
                    roomsDirtyRef.current = true;
                  }}
                  title="Activar / Desactivar"
                />
                <input
                  type="text"
                  value={room.name || ""}
                  onChange={(e) => {
                    const next = [...localRoomsList];
                    next[idx] = { ...next[idx], name: e.target.value };
                    setLocalRoomsList(next);
                    setRoomsDirty(true);
                    roomsDirtyRef.current = true;
                  }}
                  placeholder="Nombre del salón"
                />
                <div className="signage-rooms-row-btns">
                  <button
                    type="button"
                    className="visual-outline-button compact"
                    disabled={idx === 0}
                    onClick={() => {
                      const copy = [...localRoomsList];
                      const [item] = copy.splice(idx, 1);
                      copy.splice(idx - 1, 0, item);
                      setLocalRoomsList(copy);
                      setRoomsDirty(true);
                      roomsDirtyRef.current = true;
                    }}
                    title="Subir orden"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="visual-outline-button compact"
                    disabled={idx === localRoomsList.length - 1}
                    onClick={() => {
                      const copy = [...localRoomsList];
                      const [item] = copy.splice(idx, 1);
                      copy.splice(idx + 1, 0, item);
                      setLocalRoomsList(copy);
                      setRoomsDirty(true);
                      roomsDirtyRef.current = true;
                    }}
                    title="Bajar orden"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="visual-outline-button compact danger"
                    onClick={() => {
                      setLocalRoomsList(localRoomsList.filter((_, i) => i !== idx));
                      setRoomsDirty(true);
                      roomsDirtyRef.current = true;
                    }}
                    title="Eliminar"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="signage-rooms-box-actions">
            <button
              type="button"
              className="visual-outline-button"
              onClick={() => {
                setLocalRoomsList([
                  ...localRoomsList,
                  {
                    id: createRoomId("room"),
                    name: `Salón ${localRoomsList.length + 1}`,
                    active: true,
                  },
                ]);
                setRoomsDirty(true);
                roomsDirtyRef.current = true;
              }}
            >
              + Agregar salón
            </button>
            <button
              type="button"
              className="visual-primary-button"
              disabled={savingRoomsConfig}
              onClick={handleSaveRoomsConfig}
            >
              {savingRoomsConfig ? "Guardando…" : "Guardar catálogo de salones"}
            </button>
            <button
              type="button"
              className="visual-outline-button"
              onClick={handleApplyRoomsToDraft}
            >
              Aplicar salones al borrador actual
            </button>
          </div>
        </section>
      )}

      <div className="signage-rooms-main-layout">
        <div className="signage-rooms-editor-column">
          <div className="signage-rooms-card">
            <div className="signage-rooms-card-header">
              <div>
                <div className="signage-rooms-header-badge-row">
                  <h3>{draft?.name || "Acomodo"}</h3>
                  {publicationState.isPublished ? (
                    <span className="signage-rooms-badge is-published">Publicado</span>
                  ) : (
                    <span className="signage-rooms-badge is-draft">Borrador</span>
                  )}
                  {(isDirty || publicationState.isPending) && (
                    <span className="signage-rooms-badge is-pending">Cambios pendientes</span>
                  )}
                </div>
                <span className="signage-rooms-subtext">
                  Sucursal: {selectedPlantel} | Zona horaria:{" "}
                  {draft?.timezone || localTimezone || "America/Tijuana"}
                </span>
              </div>

              <div className="signage-rooms-card-actions">
                <button
                  type="button"
                  className="visual-outline-button compact"
                  onClick={handleOpenCopyModal}
                  disabled={saving || publishing}
                >
                  Duplicar / Copiar
                </button>
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="signage-rooms-warning-banner">
                <strong>Advertencias detectadas:</strong>
                <ul>
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <fieldset className="signage-rooms-fieldset">
              <legend>Clase y Horario de Actividad</legend>
              <div className="signage-rooms-presets-bar">
                <span className="signage-rooms-presets-label">Horarios habituales:</span>
                {ROOM_BLOCK_PRESETS.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    className="signage-rooms-preset-chip"
                    onClick={() => applyPreset(p)}
                  >
                    {p.label || `${p.startTime}-${p.endTime}`}
                  </button>
                ))}
              </div>

              <div className="signage-rooms-form-grid">
                <label className="signage-rooms-field">
                  Nombre descriptivo del bloque
                  <input
                    type="text"
                    value={draft?.name || ""}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    placeholder="Ej. Matutino 09:00 - 10:00"
                  />
                </label>

                <div className="signage-rooms-field-pair">
                  <label className="signage-rooms-field">
                    Inicio de clase (09:00)
                    <input
                      type="time"
                      value={draft?.classStart || "09:00"}
                      onChange={(e) => updateDraft({ classStart: e.target.value })}
                    />
                  </label>
                  <label className="signage-rooms-field">
                    Fin de clase (10:00)
                    <input
                      type="time"
                      value={draft?.classEnd || "10:00"}
                      onChange={(e) => updateDraft({ classEnd: e.target.value })}
                    />
                  </label>
                </div>
              </div>

              <div className="signage-rooms-days-group">
                <span className="signage-rooms-days-label">Días de clase:</span>
                <div className="signage-rooms-day-picker" role="group" aria-label="Días de clase">
                  {WEEKDAY_NAMES.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      className={(draft?.classDays || []).includes(d.value) ? "active" : ""}
                      onClick={() => toggleClassDay(d.value)}
                      title={d.label}
                    >
                      {d.short}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>

            <fieldset className="signage-rooms-fieldset">
              <legend>Distribución de Salones y Maestros</legend>
              <div className="signage-rooms-assignments-table-wrap">
                <table className="signage-rooms-table">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>Act</th>
                      <th style={{ width: 140 }}>Salón</th>
                      <th>Maestro Asignado</th>
                      <th style={{ width: 130 }}>Grupo</th>
                      <th style={{ width: 80 }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(draft?.assignments || []).map((asg, idx) => (
                      <tr key={asg.id || idx}>
                        <td>
                          <input
                            type="checkbox"
                            checked={asg.active !== false}
                            onChange={(e) =>
                              updateAssignment(idx, "active", e.target.checked)
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={asg.roomName || ""}
                            onChange={(e) =>
                              updateAssignment(idx, "roomName", e.target.value)
                            }
                            placeholder="Salón"
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            list="signage-rooms-teachers-datalist"
                            value={asg.teacher || ""}
                            onChange={(e) =>
                              updateAssignment(idx, "teacher", e.target.value)
                            }
                            placeholder="Nombre del maestro"
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={asg.group || ""}
                            onChange={(e) =>
                              updateAssignment(idx, "group", e.target.value)
                            }
                            placeholder="Grupo"
                          />
                        </td>
                        <td>
                          <div className="signage-rooms-row-btns">
                            <button
                              type="button"
                              className="visual-outline-button compact"
                              onClick={() => moveAssignment(idx, "up")}
                              disabled={idx === 0}
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              className="visual-outline-button compact"
                              onClick={() => moveAssignment(idx, "down")}
                              disabled={idx === (draft.assignments?.length || 0) - 1}
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              className="visual-outline-button compact danger"
                              onClick={() => removeAssignment(idx)}
                            >
                              ×
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="signage-rooms-table-footer">
                <button
                  type="button"
                  className="visual-outline-button"
                  onClick={addAssignment}
                >
                  + Agregar fila de salón
                </button>
              </div>
            </fieldset>

            <fieldset className="signage-rooms-fieldset">
              <legend>Ventanas de Aparición en Pantallas</legend>
              <p className="signage-rooms-hint-text">
                Horarios y fechas en que las pantallas receptoras interrumpen su playlist para proyectar este acomodo.
                (Aparición independiente de la hora de clase, ej. 08:50 - 09:15).
              </p>
              <div className="signage-rooms-rules-list">
                {(draft?.displayRules || []).map((rule, rIdx) => {
                  const ruleTargetDevices =
                    Array.isArray(rule.deviceIds) && rule.deviceIds.length > 0
                      ? devicesInPlantel
                          .filter((d) => rule.deviceIds.includes(d.id || d.deviceToken))
                          .map((d) => d.name || d.deviceToken)
                          .join(", ")
                      : `Todas las pantallas activas de ${selectedPlantel}`;

                  return (
                    <div className="signage-rooms-rule-card" key={rule.id || rIdx}>
                      <div className="signage-rooms-rule-header">
                        <label className="signage-rooms-checkbox-label">
                          <input
                            type="checkbox"
                            checked={rule.active !== false}
                            onChange={(e) =>
                              updateDisplayRule(rIdx, { active: e.target.checked })
                            }
                          />
                          <strong>Ventana {rIdx + 1}</strong>
                        </label>
                        <button
                          type="button"
                          className="visual-outline-button compact danger"
                          onClick={() => removeDisplayRule(rIdx)}
                        >
                          Eliminar
                        </button>
                      </div>

                      <div className="signage-rooms-rule-summary-line">
                        <span>
                          {Array.isArray(rule.dates) && rule.dates.length > 0
                            ? `Fechas específicas (${rule.dates.length}): ${rule.dates.join(", ")}`
                            : `Recurrencia: ${(rule.daysOfWeek || [])
                                .map((d) => WEEKDAY_NAMES.find((w) => w.value === d)?.short || d)
                                .join(", ")}`}
                        </span>
                        <span> | Horario: {rule.startTime || "08:50"} – {rule.endTime || "09:15"}</span>
                        <span> | Destino: {ruleTargetDevices}</span>
                        <span> | Prioridad: {rule.priority === 2 ? "Urgente" : rule.priority === 1 ? "Alta" : "Normal"}</span>
                      </div>

                      <div className="signage-rooms-form-grid">
                        <div className="signage-rooms-field-pair">
                          <label className="signage-rooms-field">
                            Aparición (Inicio)
                            <input
                              type="time"
                              value={rule.startTime || "08:50"}
                              onChange={(e) =>
                                updateDisplayRule(rIdx, { startTime: e.target.value })
                              }
                            />
                          </label>
                          <label className="signage-rooms-field">
                            Retorno (Fin)
                            <input
                              type="time"
                              value={rule.endTime || "09:15"}
                              onChange={(e) =>
                                updateDisplayRule(rIdx, { endTime: e.target.value })
                              }
                            />
                          </label>
                        </div>

                        <label className="signage-rooms-field">
                          Prioridad
                          <select
                            value={rule.priority ?? 0}
                            onChange={(e) =>
                              updateDisplayRule(rIdx, {
                                priority: parseInt(e.target.value, 10) || 0,
                              })
                            }
                          >
                            <option value="0">Normal (Sobre playlist habitual)</option>
                            <option value="1">Alta</option>
                            <option value="2">Urgente (Crítica)</option>
                          </select>
                        </label>
                      </div>

                      <div className="signage-rooms-days-group">
                        <span className="signage-rooms-days-label">Días de aparición (semanal):</span>
                        <div className="signage-rooms-day-picker" role="group" aria-label="Días de aparición">
                          {WEEKDAY_NAMES.map((d) => (
                            <button
                              key={d.value}
                              type="button"
                              className={(rule.daysOfWeek || []).includes(d.value) ? "active" : ""}
                              onClick={() => {
                                const current = rule.daysOfWeek || [];
                                const next = current.includes(d.value)
                                  ? current.filter((x) => x !== d.value)
                                  : [...current, d.value].sort((a, b) => a - b);
                                updateDisplayRule(rIdx, { daysOfWeek: next });
                              }}
                              title={d.label}
                            >
                              {d.short}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="signage-rooms-dates-box">
                        <span className="signage-rooms-days-label">
                          Fechas específicas YYYY-MM-DD (sustituyen la recurrencia semanal si se definen):
                        </span>
                        <div className="signage-rooms-date-add-row">
                          <input
                            type="date"
                            id={`signage-date-input-${rIdx}`}
                            defaultValue=""
                          />
                          <button
                            type="button"
                            className="visual-outline-button compact"
                            onClick={() => {
                              const el = document.getElementById(`signage-date-input-${rIdx}`);
                              if (el && el.value) {
                                const current = Array.isArray(rule.dates) ? rule.dates : [];
                                if (!current.includes(el.value)) {
                                  updateDisplayRule(rIdx, { dates: [...current, el.value].sort() });
                                }
                                el.value = "";
                              }
                            }}
                          >
                            + Agregar fecha
                          </button>
                        </div>
                        {Array.isArray(rule.dates) && rule.dates.length > 0 && (
                          <div className="signage-rooms-dates-chips">
                            {rule.dates.map((dateStr) => (
                              <span key={dateStr} className="signage-rooms-date-chip">
                                {dateStr}
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateDisplayRule(rIdx, {
                                      dates: rule.dates.filter((d) => d !== dateStr),
                                    });
                                  }}
                                  title="Quitar fecha"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="signage-rooms-devices-target-box">
                        <span className="signage-rooms-days-label">
                          Pantallas receptoras ({selectedPlantel}):
                        </span>
                        <label className="signage-rooms-checkbox-label">
                          <input
                            type="checkbox"
                            checked={!rule.deviceIds || rule.deviceIds.length === 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                updateDisplayRule(rIdx, { deviceIds: [] });
                              } else {
                                updateDisplayRule(rIdx, {
                                  deviceIds: devicesInPlantel.some((device) => device.active !== false)
                                    ? [devicesInPlantel.find((device) => device.active !== false).id || devicesInPlantel.find((device) => device.active !== false).deviceToken]
                                    : [],
                                });
                              }
                            }}
                          />
                          <span>Todas las pantallas activas de {selectedPlantel}</span>
                        </label>

                        {Array.isArray(rule.deviceIds) && rule.deviceIds.length > 0 && (
                          <div className="signage-rooms-device-checkboxes-grid">
                            {devicesInPlantel.filter((dev) => dev.active !== false || rule.deviceIds.includes(dev.id || dev.deviceToken)).map((dev) => {
                              const devId = dev.id || dev.deviceToken;
                              const isChecked = rule.deviceIds.includes(devId);
                              return (
                                <label key={devId} className="signage-rooms-checkbox-label compact">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      let nextIds;
                                      if (e.target.checked) {
                                        nextIds = [...rule.deviceIds, devId];
                                      } else {
                                        nextIds = rule.deviceIds.filter((id) => id !== devId);
                                        if (nextIds.length === 0) {
                                          setApiError("Conserva al menos una pantalla o selecciona explícitamente todas las pantallas.");
                                          return;
                                        }
                                      }
                                      updateDisplayRule(rIdx, { deviceIds: nextIds });
                                    }}
                                  />
                                  <span>{dev.name || dev.deviceToken || "Pantalla"}{dev.active === false ? " (inactiva)" : ""}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="visual-outline-button"
                onClick={addDisplayRule}
              >
                + Agregar ventana de aparición
              </button>
            </fieldset>

            <fieldset className="signage-rooms-fieldset">
              <legend>Plantilla Visual Asignada</legend>
              <div className="signage-rooms-template-picker-row">
                <label className="signage-rooms-field" style={{ flex: 1 }}>
                  Plantilla activa:
                  <select
                    value={draft?.templateId || ""}
                    onChange={(e) => updateDraft({ templateId: e.target.value })}
                  >
                    <option value="">Predeterminada Institucional (Azul AES)</option>
                    {adminData.templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name || "Plantilla sin nombre"}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="signage-rooms-template-btns">
                  <button
                    type="button"
                    className="visual-outline-button"
                    onClick={(e) => handleOpenEditor("edit", e)}
                  >
                    Personalizar
                  </button>
                  <button
                    type="button"
                    className="visual-outline-button"
                    onClick={(e) => handleOpenEditor("new", e)}
                  >
                    + Nueva
                  </button>
                  <button
                    type="button"
                    className="visual-outline-button"
                    onClick={(e) => handleOpenEditor("duplicate", e)}
                  >
                    Duplicar
                  </button>
                </div>
              </div>
            </fieldset>

            <div className="signage-rooms-panel-footer">
              <button
                type="button"
                className="visual-primary-button"
                disabled={saving || publishing}
                onClick={() => handleSaveDraft()}
              >
                {saving ? "Guardando borrador…" : "Guardar borrador"}
              </button>

              <button
                type="button"
                className="visual-primary-button success"
                disabled={saving || publishing}
                onClick={handlePublish}
              >
                {publishing ? "Publicando…" : "Publicar en pantallas"}
              </button>

              {publicationState.isPublished && (
                <button
                  type="button"
                  className="visual-outline-button danger"
                  disabled={saving || publishing}
                  onClick={handleUnpublish}
                >
                  Despublicar
                </button>
              )}
            </div>
          </div>
        </div>

        <aside className="signage-rooms-preview-column">
          <div className="signage-rooms-card sticky">
            <div className="signage-rooms-card-header">
              <h3>Vista Previa en Vivo (16:9)</h3>
              <span className="signage-rooms-badge is-tv">Modo Pantalla</span>
            </div>
            <p className="signage-rooms-subtext">
              Así lucirá la pantalla en recepción durante la ventana programada.
            </p>

            <div className="signage-rooms-preview-screen-box">
              <RoomLayoutDisplay
                layout={draft}
                template={currentTemplate}
                nowMillis={previewNowMillis}
              />
            </div>

            <div className="signage-rooms-preview-summary">
              <strong>Resumen de programación:</strong>
              <p>
                Clase:{" "}
                {getRoomDayLabel ? getRoomDayLabel(draft?.classDays) : "L-V"} |{" "}
                {formatRoomClassTime ? formatRoomClassTime(draft) : `${draft?.classStart} - ${draft?.classEnd}`}
              </p>
              <p>
                Salones activos:{" "}
                {(draft?.assignments || []).filter((a) => a.active).length} de{" "}
                {draft?.assignments?.length || 0}
              </p>
              <p>
                Ventanas configuradas: {draft?.displayRules?.length || 0}
              </p>
            </div>
          </div>
        </aside>
      </div>

      {isEditorOpen && (
        <div
          className="signage-rooms-editor-modal-wrap"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signage-rooms-editor-modal-title"
          onKeyDown={(e) => handleModalKeyDown(e, handleCloseEditor)}
        >
          <div className="signage-rooms-editor-modal" ref={editorModalRef}>
            <div className="signage-rooms-modal-header">
              <h3 id="signage-rooms-editor-modal-title">
                Editor Visual de Plantillas de Salones
              </h3>
              <button
                type="button"
                className="visual-outline-button compact"
                onClick={handleCloseEditor}
              >
                Cerrar
              </button>
            </div>
            <RoomLayoutTemplateEditor
              template={editingTemplate || currentTemplate}
              layout={draft}
              onChange={(next) => {
                setEditingTemplate(next);
                setTemplateDirty(true);
                templateDirtyRef.current = true;
              }}
              onSave={handleSaveTemplate}
              onUploadImage={async (file) => {
                setUploadingTemplate(true);
                try {
                  return await uploadRoomTemplateImage(file, profile);
                } finally {
                  setUploadingTemplate(false);
                }
              }}
              saving={savingTemplate}
            />
          </div>
        </div>
      )}

      {showCopyModal && (
        <div
          className="signage-rooms-copy-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signage-rooms-copy-modal-title"
          onKeyDown={(e) =>
            handleModalKeyDown(e, () => {
              setShowCopyModal(false);
              if (copyOpenerRef.current) copyOpenerRef.current.focus();
            })
          }
        >
          <div className="signage-rooms-copy-modal" ref={copyModalRef}>
            <h3 id="signage-rooms-copy-modal-title">Duplicar / Copiar Acomodo de Salones</h3>
            <p>
              Se creará un nuevo borrador independiente con IDs propios sin modificar el origen.
            </p>

            <label className="signage-rooms-field">
              Nombre del nuevo acomodo:
              <input
                type="text"
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
              />
            </label>

            <label className="signage-rooms-field">
              Plantel destino:
              <select
                value={copyTargetPlantel}
                onChange={(e) => setCopyTargetPlantel(e.target.value)}
              >
                {allPlanteles.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            <div className="signage-rooms-field-pair">
              <label className="signage-rooms-field">
                Inicio clase destino:
                <input
                  type="time"
                  value={copyClassStart}
                  onChange={(e) => setCopyClassStart(e.target.value)}
                />
              </label>
              <label className="signage-rooms-field">
                Fin clase destino:
                <input
                  type="time"
                  value={copyClassEnd}
                  onChange={(e) => setCopyClassEnd(e.target.value)}
                />
              </label>
            </div>

            <div className="signage-rooms-field-pair">
              <label className="signage-rooms-field">
                Aparición pantalla (Inicio):
                <input
                  type="time"
                  value={copyStartTime}
                  onChange={(e) => setCopyStartTime(e.target.value)}
                />
              </label>
              <label className="signage-rooms-field">
                Aparición pantalla (Fin):
                <input
                  type="time"
                  value={copyEndTime}
                  onChange={(e) => setCopyEndTime(e.target.value)}
                />
              </label>
            </div>

            <div className="signage-rooms-days-group">
              <span className="signage-rooms-days-label">Días clase destino:</span>
              <div className="signage-rooms-day-picker" role="group" aria-label="Días copia">
                {WEEKDAY_NAMES.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    className={copyClassDays.includes(d.value) ? "active" : ""}
                    onClick={() => {
                      const next = copyClassDays.includes(d.value)
                        ? copyClassDays.filter((x) => x !== d.value)
                        : [...copyClassDays, d.value].sort((a, b) => a - b);
                      setCopyClassDays(next);
                    }}
                  >
                    {d.short}
                  </button>
                ))}
              </div>
            </div>

            <div className="signage-rooms-modal-actions">
              <button
                type="button"
                className="visual-outline-button"
                onClick={() => {
                  setShowCopyModal(false);
                  if (copyOpenerRef.current) copyOpenerRef.current.focus();
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="visual-primary-button"
                onClick={handleExecuteCopy}
              >
                Crear copia independiente
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
