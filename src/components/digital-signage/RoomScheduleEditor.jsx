import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import RoomTeacherPicker from "./RoomTeacherPicker";
import { createRoomId } from "../../utils/digitalSignage/roomLayouts";
import {
  createRoomSchedule,
  getScheduleCell,
} from "../../utils/digitalSignage/roomSchedule";

const EMPTY_ASSIGNMENTS = [];

const PRESET_INTERVAL_TEMPLATES = [
  {
    id: "vespertino_1h",
    label: "Vespertino (15:00 a 20:00 — 1 hora)",
    columns: [
      { label: "3:00 PM", startTime: "15:00", endTime: "16:00" },
      { label: "4:00 PM", startTime: "16:00", endTime: "17:00" },
      { label: "5:00 PM", startTime: "17:00", endTime: "18:00" },
      { label: "6:00 PM", startTime: "18:00", endTime: "19:00" },
      { label: "7:00 PM", startTime: "19:00", endTime: "20:00" },
    ],
  },
  {
    id: "matutino_1h",
    label: "Matutino (08:00 a 12:00 — 1 hora)",
    columns: [
      { label: "8:00 AM", startTime: "08:00", endTime: "09:00" },
      { label: "9:00 AM", startTime: "09:00", endTime: "10:00" },
      { label: "10:00 AM", startTime: "10:00", endTime: "11:00" },
      { label: "11:00 AM", startTime: "11:00", endTime: "12:00" },
    ],
  },
  {
    id: "sabados_1h",
    label: "Sábados (09:00 a 14:00 — 1 hora)",
    columns: [
      { label: "9:00 AM", startTime: "09:00", endTime: "10:00" },
      { label: "10:00 AM", startTime: "10:00", endTime: "11:00" },
      { label: "11:00 AM", startTime: "11:00", endTime: "12:00" },
      { label: "12:00 PM", startTime: "12:00", endTime: "13:00" },
      { label: "1:00 PM", startTime: "13:00", endTime: "14:00" },
    ],
  },
];

export default function RoomScheduleEditor({
  layout,
  onChange,
  onOpenTemplateEditor,
  teachers = [],
  teachersLoading = false,
  teachersError = "",
}) {
  const assignments = layout?.assignments || EMPTY_ASSIGNMENTS;
  // El borrador conserva espacios y valores parciales mientras se escribe.
  // La validación y normalización se realizan al guardar, no en cada tecla.
  const schedule = layout?.schedule || createRoomSchedule(assignments);

  const [activeTab, setActiveTab] = useState("grid");
  const [activeViewFilter, setActiveViewFilter] = useState("all");
  const [selectedCellPos, setSelectedCellPos] = useState(null);
  const [cellClipboard, setCellClipboard] = useState(null);
  const [statusNotice, setStatusNotice] = useState(null);

  const historyRef = useRef([]);
  const [historySize, setHistorySize] = useState(0);
  const stateRef = useRef({ schedule, assignments });
  useEffect(() => {
    stateRef.current = { schedule, assignments };
  }, [schedule, assignments]);

  const pushHistory = useCallback(() => {
    const current = stateRef.current;
    historyRef.current = [
      ...historyRef.current.slice(-24),
      {
        schedule: JSON.parse(JSON.stringify(current.schedule)),
        assignments: JSON.parse(JSON.stringify(current.assignments)),
      },
    ];
    setHistorySize(historyRef.current.length);
  }, []);

  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const previous = historyRef.current.pop();
    setHistorySize(historyRef.current.length);
    onChange({
      schedule: previous.schedule,
      assignments: previous.assignments,
    });
    setStatusNotice("Acción deshecha correctamente.");
    setTimeout(() => setStatusNotice(null), 2500);
  }, [onChange]);

  const commitScheduleChange = useCallback(
    (nextSchedule, nextAssignments = null) => {
      pushHistory();
      const updatedAssignments = nextAssignments || stateRef.current.assignments;
      onChange({
        schedule: nextSchedule,
        assignments: updatedAssignments,
      });
    },
    [onChange, pushHistory]
  );

  const columns = useMemo(() => {
    return Array.isArray(schedule.columns) ? schedule.columns : [];
  }, [schedule.columns]);

  const tags = useMemo(() => {
    return Array.isArray(schedule.tags) ? schedule.tags : [];
  }, [schedule.tags]);

  const views = useMemo(() => {
    return Array.isArray(schedule.views) ? schedule.views : [];
  }, [schedule.views]);

  const visibleColumns = useMemo(() => {
    if (activeViewFilter === "all" || !activeViewFilter) return columns;
    const currentView = views.find((v) => v.id === activeViewFilter);
    if (!currentView || !Array.isArray(currentView.columnIds) || currentView.columnIds.length === 0) {
      return columns;
    }
    return currentView.columnIds.map(id => columns.find(col => col.id === id)).filter(Boolean);
  }, [columns, activeViewFilter, views]);

  const selectedCellData = useMemo(() => {
    if (!selectedCellPos) return null;
    const { rowId, columnId } = selectedCellPos;
    if (typeof getScheduleCell === "function") {
      try {
        const found = getScheduleCell(schedule, rowId, columnId);
        if (found) return found;
      } catch { /* Continúa con la celda vacía. */ }
    }
    const rawCells = Array.isArray(schedule.cells) ? schedule.cells : [];
    return (
      rawCells.find((c) => c && c.rowId === rowId && c.columnId === columnId) || {
        rowId,
        columnId,
        teacher: "",
        activity: "",
        tagIds: [],
        color: "",
        backgroundColor: "",
      }
    );
  }, [selectedCellPos, schedule]);

  function updateCell(rowId, columnId, partial) {
    const rawCells = Array.isArray(schedule.cells) ? [...schedule.cells] : [];
    const cellIdx = rawCells.findIndex((c) => c && c.rowId === rowId && c.columnId === columnId);
    let nextCell;
    if (cellIdx >= 0) {
      nextCell = { ...rawCells[cellIdx], ...partial };
      const isEmpty =
        !nextCell.teacher?.trim() &&
        !nextCell.activity?.trim() &&
        (!nextCell.tagIds || nextCell.tagIds.length === 0) &&
        !nextCell.color &&
        !nextCell.backgroundColor;
      if (isEmpty) {
        rawCells.splice(cellIdx, 1);
      } else {
        rawCells[cellIdx] = nextCell;
      }
    } else {
      nextCell = {
        rowId,
        columnId,
        teacher: "",
        activity: "",
        tagIds: [],
        color: "",
        backgroundColor: "",
        ...partial,
      };
      const isEmpty =
        !nextCell.teacher?.trim() &&
        !nextCell.activity?.trim() &&
        (!nextCell.tagIds || nextCell.tagIds.length === 0) &&
        !nextCell.color &&
        !nextCell.backgroundColor;
      if (!isEmpty) {
        rawCells.push(nextCell);
      }
    }

    commitScheduleChange({
      ...schedule,
      cells: rawCells,
    });
  }

  function handleCopyCell() {
    if (!selectedCellData) return;
    setCellClipboard({
      teacher: selectedCellData.teacher || "",
      activity: selectedCellData.activity || "",
      tagIds: Array.isArray(selectedCellData.tagIds) ? [...selectedCellData.tagIds] : [],
      color: selectedCellData.color || "",
      backgroundColor: selectedCellData.backgroundColor || "",
    });
    setStatusNotice("Celda copiada al portapapeles.");
    setTimeout(() => setStatusNotice(null), 2000);
  }

  function handlePasteCell() {
    if (!selectedCellPos || !cellClipboard) return;
    updateCell(selectedCellPos.rowId, selectedCellPos.columnId, cellClipboard);
    setStatusNotice("Asignación pegada en la celda seleccionada.");
    setTimeout(() => setStatusNotice(null), 2000);
  }

  function handleClearCell() {
    if (!selectedCellPos) return;
    updateCell(selectedCellPos.rowId, selectedCellPos.columnId, {
      teacher: "",
      activity: "",
      tagIds: [],
      color: "",
      backgroundColor: "",
    });
  }

  function handleAddAssignmentRow() {
    if (assignments.length >= 200) return window.alert("El máximo es de 200 salones.");
    const nextAssignments = [
      ...assignments,
      {
        id: createRoomId("assignment"),
        roomName: `Salón ${assignments.length + 1}`,
        teacher: "",
        group: "",
        active: true,
      },
    ];
    commitScheduleChange(schedule, nextAssignments);
  }

  function handleRemoveAssignmentRow(index) {
    const rowToRemove = assignments[index];
    if (!rowToRemove) return;
    const nextAssignments = assignments.filter((_, i) => i !== index);
    const nextCells = (schedule.cells || []).filter((c) => c && c.rowId !== rowToRemove.id);
    commitScheduleChange(
      {
        ...schedule,
        cells: nextCells,
      },
      nextAssignments
    );
    if (selectedCellPos?.rowId === rowToRemove.id) {
      setSelectedCellPos(null);
    }
  }

  function handleMoveAssignmentRow(index, direction) {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= assignments.length) return;
    const copy = [...assignments];
    const [item] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, item);
    commitScheduleChange(schedule, copy);
  }

  function handleUpdateAssignmentRow(index, field, value) {
    const copy = [...assignments];
    copy[index] = { ...copy[index], [field]: value };
    commitScheduleChange(schedule, copy);
  }

  function handleAddColumn() {
    if (columns.length >= 48) return window.alert("El máximo es de 48 horarios.");
    const lastTime = columns.at(-1)?.endTime || "08:00";
    const [hours, minutes] = lastTime.split(":").map(Number);
    const start = Math.min(1379, (hours || 0) * 60 + (minutes || 0));
    const toTime = value => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    const newId = createRoomId("col");
    const newCol = {
      id: newId,
      label: toTime(start),
      startTime: toTime(start),
      endTime: toTime(start + 60),
    };
    const nextColumns = [...columns, newCol];
    const nextViews = views.map((v) => ({
      ...v,
      columnIds: Array.isArray(v.columnIds) && v.columnIds.length > 0 ? [...v.columnIds, newId] : [],
    }));
    commitScheduleChange({
      ...schedule,
      columns: nextColumns,
      views: nextViews,
    });
  }

  function handleRemoveColumn(colId) {
    if (columns.length <= 1) {
      alert("Debe conservarse al menos una columna de horario.");
      return;
    }
    const nextColumns = columns.filter((c) => c.id !== colId);
    const nextCells = (schedule.cells || []).filter((c) => c && c.columnId !== colId);
    const nextViews = views.map((v) => ({
      ...v,
      columnIds: (v.columnIds || []).filter((id) => id !== colId).length ? (v.columnIds || []).filter((id) => id !== colId) : [nextColumns[0].id],
    }));
    commitScheduleChange({
      ...schedule,
      columns: nextColumns,
      cells: nextCells,
      views: nextViews,
    });
    if (selectedCellPos?.columnId === colId) {
      setSelectedCellPos(null);
    }
  }

  function handleMoveColumn(index, direction) {
    const targetIdx = direction === "left" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= columns.length) return;
    const copy = [...columns];
    const [col] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, col);
    commitScheduleChange({
      ...schedule,
      columns: copy,
      views: views.map(view => ({ ...view, columnIds: copy.filter(col => view.columnIds.includes(col.id)).map(col => col.id) })),
    });
  }

  function handleDuplicateColumn(colId) {
    if (columns.length >= 48) return window.alert("El máximo es de 48 horarios.");
    const sourceCol = columns.find((c) => c.id === colId);
    if (!sourceCol) return;
    const newId = createRoomId("col");
    const duplicatedCol = {
      ...sourceCol,
      id: newId,
      label: `${sourceCol.label} (Copia)`,
    };
    const nextColumns = [...columns, duplicatedCol];
    const existingCellsToCopy = (schedule.cells || [])
      .filter((c) => c && c.columnId === colId)
      .map((c) => ({
        ...c,
        columnId: newId,
      }));
    const nextCells = [...(schedule.cells || []), ...existingCellsToCopy];
    const nextViews = views.map((v) => ({
      ...v,
      columnIds: Array.isArray(v.columnIds) && v.columnIds.length > 0 ? [...v.columnIds, newId] : [],
    }));
    commitScheduleChange({
      ...schedule,
      columns: nextColumns,
      cells: nextCells,
      views: nextViews,
    });
    setStatusNotice(`Columna "${sourceCol.label}" duplicada con sus asignaciones.`);
    setTimeout(() => setStatusNotice(null), 2500);
  }

  function handleApplyPresetColumns(presetId) {
    const preset = PRESET_INTERVAL_TEMPLATES.find((p) => p.id === presetId);
    if (!preset) return;
    if (
      schedule.cells?.length > 0 &&
      !window.confirm("Aplicar este intervalo reemplazará las columnas y eliminará sus asignaciones del borrador. Puedes deshacer el cambio. ¿Deseas continuar?")
    ) {
      return;
    }
    const generated = preset.columns.map((c) => ({
      id: createRoomId("col"),
      label: c.label,
      startTime: c.startTime,
      endTime: c.endTime,
    }));
    const nextViews = views.map((v) => ({
      ...v,
      columnIds: generated.map((g) => g.id),
    }));
    commitScheduleChange({
      ...schedule,
      columns: generated,
      cells: [],
      views: nextViews,
    });
    setStatusNotice(`Intervalo predefinido "${preset.label}" aplicado.`);
    setTimeout(() => setStatusNotice(null), 2500);
  }

  function handleAddView() {
    if (views.length >= 48) return window.alert("El máximo es de 48 vistas.");
    const newId = createRoomId("view");
    const newView = {
      id: newId,
      name: `Vista ${views.length + 1}`,
      columnIds: columns.slice(0, 3).map((c) => c.id),
      rowsPerPage: 8,
      columnsPerPage: 3,
      pageSeconds: 10,
      rotate: true,
    };
    commitScheduleChange({
      ...schedule,
      views: [...views, newView],
    });
  }

  function handleUpdateView(viewId, partial) {
    const nextViews = views.map((v) => (v.id === viewId ? { ...v, ...partial } : v));
    commitScheduleChange({
      ...schedule,
      views: nextViews,
    });
  }

  function handleRemoveView(viewId) {
    if (views.length <= 1) {
      alert("Debe conservarse al menos una vista de presentación.");
      return;
    }
    const nextViews = views.filter((v) => v.id !== viewId);
    commitScheduleChange({
      ...schedule,
      views: nextViews,
    });
    if (activeViewFilter === viewId) {
      setActiveViewFilter("all");
    }
  }

  function handleAddTag() {
    if (tags.length >= 100) return window.alert("El máximo es de 100 etiquetas.");
    const newTag = {
      id: createRoomId("tag"),
      name: `Etiqueta ${tags.length + 1}`,
      color: "#ffffff",
      backgroundColor: "#0284c7",
    };
    commitScheduleChange({
      ...schedule,
      tags: [...tags, newTag],
    });
  }

  function handleUpdateTag(tagId, partial) {
    const nextTags = tags.map((t) => (t.id === tagId ? { ...t, ...partial } : t));
    commitScheduleChange({
      ...schedule,
      tags: nextTags,
    });
  }

  function handleRemoveTag(tagId) {
    const nextTags = tags.filter((t) => t.id !== tagId);
    const nextCells = (schedule.cells || []).map((c) => ({
      ...c,
      tagIds: Array.isArray(c.tagIds) ? c.tagIds.filter((id) => id !== tagId) : [],
    }));
    commitScheduleChange({
      ...schedule,
      tags: nextTags,
      cells: nextCells,
    });
  }

  return (
    <div className="signage-rooms-schedule-editor">
      <div className="signage-rooms-schedule-toolbar">
        <div className="signage-rooms-schedule-nav">
          <button
            type="button"
            className={`signage-rooms-subtab ${activeTab === "grid" ? "active" : ""}`}
            onClick={() => setActiveTab("grid")}
          >
            Cuadrícula de Asignaciones
          </button>
          <button
            type="button"
            className={`signage-rooms-subtab ${activeTab === "columns" ? "active" : ""}`}
            onClick={() => setActiveTab("columns")}
          >
            Horarios y Columnas ({columns.length})
          </button>
          <button
            type="button"
            className={`signage-rooms-subtab ${activeTab === "views" ? "active" : ""}`}
            onClick={() => setActiveTab("views")}
          >
            Vistas y Paginación ({views.length})
          </button>
          <button
            type="button"
            className={`signage-rooms-subtab ${activeTab === "tags" ? "active" : ""}`}
            onClick={() => setActiveTab("tags")}
          >
            Etiquetas ({tags.length})
          </button>
        </div>

        <div className="signage-rooms-schedule-top-actions">
          <button
            type="button"
            className="visual-outline-button compact"
            disabled={historySize === 0}
            onClick={handleUndo}
            title="Deshacer último cambio"
          >
            ↩ Deshacer {historySize > 0 ? `(${historySize})` : ""}
          </button>
          {typeof onOpenTemplateEditor === "function" && (
            <button
              type="button"
              className="visual-outline-button compact"
              onClick={onOpenTemplateEditor}
            >
              Diseñar Plantilla
            </button>
          )}
        </div>
      </div>

      {statusNotice && <div className="signage-rooms-toast-notice">{statusNotice}</div>}

      {activeTab === "grid" && (
        <div className="signage-rooms-grid-workspace">
          <div className="signage-rooms-grid-filter-bar">
            <label className="signage-rooms-view-filter-label">
              Filtrar por vista:
              <select
                value={activeViewFilter}
                onChange={(e) => setActiveViewFilter(e.target.value)}
              >
                <option value="all">Todas las columnas ({columns.length})</option>
                {views.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name || "Vista sin nombre"} ({v.columnIds?.length || 0} columnas)
                  </option>
                ))}
              </select>
            </label>

            <div className="signage-rooms-grid-quick-tools">
              <button
                type="button"
                className="visual-outline-button compact"
                onClick={handleAddAssignmentRow}
              >
                + Agregar salón
              </button>
              <button
                type="button"
                className="visual-outline-button compact"
                onClick={handleAddColumn}
              >
                + Agregar horario
              </button>
            </div>
          </div>

          <div className="signage-rooms-matrix-scroll-wrap">
            <table className="signage-rooms-matrix-table">
              <thead>
                <tr>
                  <th className="signage-rooms-matrix-th-room">Salón</th>
                  {visibleColumns.map((col, cIdx) => (
                    <th key={col.id || cIdx} className="signage-rooms-matrix-th-col">
                      <div className="signage-rooms-col-header-box">
                        <span className="signage-rooms-col-header-title">{col.label}</span>
                        <span className="signage-rooms-col-header-time">
                          {col.startTime} – {col.endTime}
                        </span>
                        <div className="signage-rooms-col-mini-actions">
                          <button
                            type="button"
                            onClick={() => handleMoveColumn(columns.findIndex(item => item.id === col.id), "left")}
                            disabled={cIdx === 0}
                            title="Mover columna a la izquierda"
                          >
                            ◀
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateColumn(col.id)}
                            title="Duplicar columna"
                          >
                            ⧉
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveColumn(columns.findIndex(item => item.id === col.id), "right")}
                            disabled={cIdx === visibleColumns.length - 1}
                            title="Mover columna a la derecha"
                          >
                            ▶
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveColumn(col.id)}
                            className="danger"
                            title="Eliminar columna"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment, rIdx) => {
                  return (
                    <tr key={assignment.id || rIdx}>
                      <td className="signage-rooms-matrix-td-room">
                        <div className="signage-rooms-room-row-badge">
                          <input
                            type="text"
                            value={assignment.roomName || ""}
                            onChange={(e) =>
                              handleUpdateAssignmentRow(rIdx, "roomName", e.target.value)
                            }
                            className="signage-rooms-room-name-input"
                            placeholder={`Salón ${rIdx + 1}`}
                          />
                          <div className="signage-rooms-room-row-tools">
                            <button
                              type="button"
                              onClick={() => handleMoveAssignmentRow(rIdx, "up")}
                              disabled={rIdx === 0}
                              title="Subir fila"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveAssignmentRow(rIdx, "down")}
                              disabled={rIdx === assignments.length - 1}
                              title="Bajar fila"
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveAssignmentRow(rIdx)}
                              className="danger"
                              title="Eliminar fila"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      </td>
                      {visibleColumns.map((col) => {
                        const isSelected =
                          selectedCellPos?.rowId === assignment.id &&
                          selectedCellPos?.columnId === col.id;
                        let cellData = null;
                        if (typeof getScheduleCell === "function") {
                          try {
                            cellData = getScheduleCell(schedule, assignment.id, col.id);
                          } catch { /* Continúa con la celda vacía. */ }
                        }
                        if (!cellData) {
                          cellData = (schedule.cells || []).find(
                            (c) => c && c.rowId === assignment.id && c.columnId === col.id
                          );
                        }

                        const cellTags = (cellData?.tagIds || [])
                          .map((tId) => tags.find((t) => t.id === tId))
                          .filter(Boolean);

                        const hasContent =
                          Boolean(cellData?.teacher?.trim()) ||
                          Boolean(cellData?.activity?.trim()) ||
                          cellTags.length > 0;

                        return (
                          <td
                            key={col.id}
                            className={`signage-rooms-matrix-td-cell ${
                              isSelected ? "is-selected" : ""
                            } ${hasContent ? "has-data" : "is-empty"}`}
                            tabIndex={0}
                            aria-label={`Salón ${assignment.roomName}, ${col.label}`}
                            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedCellPos({rowId: assignment.id, columnId: col.id}); } }}
                            onClick={() =>
                              setSelectedCellPos({
                                rowId: assignment.id,
                                columnId: col.id,
                              })
                            }
                          >
                            <div
                              className="signage-rooms-cell-tile"
                              style={{
                                backgroundColor: cellData?.backgroundColor || undefined,
                                color: cellData?.color || undefined,
                              }}
                            >
                              {cellData?.teacher && (
                                <div className="signage-rooms-cell-teacher-name">
                                  {cellData.teacher}
                                </div>
                              )}
                              {cellData?.activity && (
                                <div className="signage-rooms-cell-activity-name">
                                  {cellData.activity}
                                </div>
                              )}
                              {cellTags.length > 0 && (
                                <div className="signage-rooms-cell-tags-row">
                                  {cellTags.map((tag) => (
                                    <span
                                      key={tag.id}
                                      className="signage-rooms-tag-chip"
                                      style={{
                                        backgroundColor: tag.backgroundColor,
                                        color: tag.color,
                                      }}
                                    >
                                      {tag.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {!hasContent && (
                                <span className="signage-rooms-cell-empty-placeholder">—</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedCellPos && (
            <div className="signage-rooms-cell-inspector-panel">
              <div className="signage-rooms-inspector-head">
                <h4>
                  Editar Celda:{" "}
                  {assignments.find((a) => a.id === selectedCellPos.rowId)?.roomName || "Salón"}{" "}
                  — {columns.find((c) => c.id === selectedCellPos.columnId)?.label || "Horario"}
                </h4>
                <div className="signage-rooms-inspector-actions">
                  <button
                    type="button"
                    className="visual-outline-button compact"
                    onClick={handleCopyCell}
                  >
                    Copiar
                  </button>
                  <button
                    type="button"
                    className="visual-outline-button compact"
                    disabled={!cellClipboard}
                    onClick={handlePasteCell}
                  >
                    Pegar
                  </button>
                  <button
                    type="button"
                    className="visual-outline-button compact danger"
                    onClick={handleClearCell}
                  >
                    Limpiar celda
                  </button>
                  <button
                    type="button"
                    className="visual-outline-button compact"
                    onClick={() => setSelectedCellPos(null)}
                  >
                    Cerrar
                  </button>
                </div>
              </div>

              <div className="signage-rooms-form-grid" style={{ marginTop: 10 }}>
                <RoomTeacherPicker
                  key={`${selectedCellPos.rowId}|${selectedCellPos.columnId}`}
                  value={selectedCellData?.teacher || ""}
                  onChange={teacher => updateCell(selectedCellPos.rowId, selectedCellPos.columnId, {teacher, activity: ""})}
                  teachers={teachers}
                  loading={teachersLoading}
                  error={teachersError}
                />

                <label className="signage-rooms-field">
                  Actividad Especial (Opcional)
                  <input
                    type="text"
                    value={selectedCellData?.activity || ""}
                    onChange={(e) =>
                      updateCell(selectedCellPos.rowId, selectedCellPos.columnId, {
                        activity: e.target.value,
                        teacher: "",
                      })
                    }
                    placeholder="Ej. Conversation Club, Taller…"
                  />
                </label>
              </div>

              <div className="signage-rooms-tags-selector-section">
                <span className="signage-rooms-days-label">Etiquetas especiales para esta celda:</span>
                <div className="signage-rooms-tags-chips-selection">
                  {tags.map((tag) => {
                    const isChecked = (selectedCellData?.tagIds || []).includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`signage-rooms-tag-toggle-chip ${isChecked ? "active" : ""}`}
                        aria-label={tag.name}
                        aria-pressed={isChecked}
                        style={{
                          backgroundColor: isChecked ? tag.backgroundColor : "#f1f5f9",
                          color: isChecked ? tag.color : "#334155",
                          borderColor: tag.backgroundColor,
                        }}
                        onClick={() => {
                          const currentTagIds = selectedCellData?.tagIds || [];
                          if (!isChecked && currentTagIds.length >= 10) return window.alert("Cada celda admite máximo 10 etiquetas.");
                          const nextTagIds = isChecked
                            ? currentTagIds.filter((id) => id !== tag.id)
                            : [...currentTagIds, tag.id];
                          updateCell(selectedCellPos.rowId, selectedCellPos.columnId, {
                            tagIds: nextTagIds,
                          });
                        }}
                      >
                        {tag.name} {isChecked ? "✓" : "+"}
                      </button>
                    );
                  })}
                  {tags.length === 0 && (
                    <span className="signage-rooms-subtext">
                      No hay etiquetas creadas. Ve a la pestaña &quot;Etiquetas&quot; para crear KIDS, Conversation Club, etc.
                    </span>
                  )}
                </div>
              </div>

              <div className="signage-rooms-field-pair" style={{ marginTop: 10 }}>
                <label className="signage-rooms-field">
                  Fondo personalizado (opcional)
                  <input
                    type="text"
                    value={selectedCellData?.backgroundColor || ""}
                    onChange={(e) =>
                      updateCell(selectedCellPos.rowId, selectedCellPos.columnId, {
                        backgroundColor: e.target.value,
                      })
                    }
                    placeholder="#edf4ff o vacío para diseño por defecto"
                  />
                </label>
                <label className="signage-rooms-field">
                  Color texto personalizado (opcional)
                  <input
                    type="text"
                    value={selectedCellData?.color || ""}
                    onChange={(e) =>
                      updateCell(selectedCellPos.rowId, selectedCellPos.columnId, {
                        color: e.target.value,
                      })
                    }
                    placeholder="#11243a o vacío"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "columns" && (
        <div className="signage-rooms-columns-manager">
          <div className="signage-rooms-presets-bar">
            <span className="signage-rooms-presets-label">Generar columnas predefinidas:</span>
            {PRESET_INTERVAL_TEMPLATES.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="signage-rooms-preset-chip"
                onClick={() => handleApplyPresetColumns(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="signage-rooms-columns-list">
            {columns.map((col, idx) => (
              <div key={col.id || idx} className="signage-rooms-column-item-card">
                <div className="signage-rooms-column-index">{idx + 1}</div>
                <div className="signage-rooms-form-grid" style={{ flex: 1, margin: 0 }}>
                  <label className="signage-rooms-field">
                    Etiqueta visible
                    <input
                      type="text"
                      value={col.label || ""}
                      onChange={(e) => {
                        const copy = [...columns];
                        copy[idx] = { ...copy[idx], label: e.target.value };
                        commitScheduleChange({ ...schedule, columns: copy });
                      }}
                      placeholder="Ej. 3:00 PM"
                    />
                  </label>
                  <label className="signage-rooms-field">
                    Hora inicio
                    <input
                      type="time"
                      value={col.startTime || "15:00"}
                      onChange={(e) => {
                        const copy = [...columns];
                        copy[idx] = { ...copy[idx], startTime: e.target.value };
                        commitScheduleChange({ ...schedule, columns: copy });
                      }}
                    />
                  </label>
                  <label className="signage-rooms-field">
                    Hora fin
                    <input
                      type="time"
                      value={col.endTime || "16:00"}
                      onChange={(e) => {
                        const copy = [...columns];
                        copy[idx] = { ...copy[idx], endTime: e.target.value };
                        commitScheduleChange({ ...schedule, columns: copy });
                      }}
                    />
                  </label>
                </div>
                <div className="signage-rooms-row-btns">
                  <button
                    type="button"
                    className="visual-outline-button compact"
                    disabled={idx === 0}
                    onClick={() => handleMoveColumn(idx, "left")}
                    title="Mover arriba"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="visual-outline-button compact"
                    disabled={idx === columns.length - 1}
                    onClick={() => handleMoveColumn(idx, "right")}
                    title="Mover abajo"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="visual-outline-button compact"
                    onClick={() => handleDuplicateColumn(col.id)}
                    title="Duplicar columna"
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="visual-outline-button compact danger"
                    onClick={() => handleRemoveColumn(col.id)}
                    title="Eliminar columna"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="visual-outline-button"
            style={{ marginTop: 12 }}
            onClick={handleAddColumn}
          >
            + Agregar columna de horario
          </button>
        </div>
      )}

      {activeTab === "views" && (
        <div className="signage-rooms-views-manager">
          <p className="signage-rooms-subtext" style={{ marginBottom: 12 }}>
            Las vistas permiten agrupar horarios en bloques (ej. Vista A: 3 PM a 5 PM; Vista B: 6 PM a 8 PM) para que la información se lea fácilmente en televisores sin reducir demasiado la letra.
          </p>

          <div className="signage-rooms-views-grid">
            {views.map((view, vIdx) => (
              <div key={view.id || vIdx} className="signage-rooms-view-card">
                <div className="signage-rooms-view-card-header">
                  <strong>Vista {vIdx + 1}: {view.name || "Sin título"}</strong>
                  {views.length > 1 && (
                    <button
                      type="button"
                      className="visual-outline-button compact danger"
                      onClick={() => handleRemoveView(view.id)}
                    >
                      Eliminar vista
                    </button>
                  )}
                </div>

                <label className="signage-rooms-field">
                  Nombre descriptivo de la vista
                  <input
                    type="text"
                    value={view.name || ""}
                    onChange={(e) => handleUpdateView(view.id, { name: e.target.value })}
                    placeholder="Ej. Tarde 1 (3 PM - 5 PM)"
                  />
                </label>

                <div className="signage-rooms-coords-grid" style={{ marginTop: 8 }}>
                  <label className="signage-rooms-field">
                    Salones por página (1..12)
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={view.rowsPerPage || 8}
                      onChange={(e) =>
                        handleUpdateView(view.id, {
                          rowsPerPage: Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 8)),
                        })
                      }
                    />
                  </label>
                  <label className="signage-rooms-field">
                    Columnas por página (1..6)
                    <input
                      type="number"
                      min="1"
                      max="6"
                      value={view.columnsPerPage || 3}
                      onChange={(e) =>
                        handleUpdateView(view.id, {
                          columnsPerPage: Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 3)),
                        })
                      }
                    />
                  </label>
                  <label className="signage-rooms-field">
                    Segundos por página
                    <input
                      type="number"
                      min="3"
                      max="120"
                      value={view.pageSeconds || 10}
                      onChange={(e) =>
                        handleUpdateView(view.id, {
                          pageSeconds: Math.min(120, Math.max(3, parseInt(e.target.value, 10) || 10)),
                        })
                      }
                    />
                  </label>
                  <label className="signage-rooms-checkbox-label" style={{ marginTop: 22 }}>
                    <input
                      type="checkbox"
                      checked={view.rotate !== false}
                      onChange={(e) => handleUpdateView(view.id, { rotate: e.target.checked })}
                    />
                    <span>Rotar páginas automáticamente (desactivado: solo primera página)</span>
                  </label>
                </div>

                <div className="signage-rooms-view-columns-selector" style={{ marginTop: 12 }}>
                  <span className="signage-rooms-days-label">Columnas que aparecen en esta vista:</span>
                  <div className="signage-rooms-checkboxes-grid">
                    {columns.map((c) => {
                      const isIncluded =
                        !Array.isArray(view.columnIds) ||
                        view.columnIds.length === 0 ||
                        view.columnIds.includes(c.id);
                      return (
                        <label key={c.id} className="signage-rooms-checkbox-label compact">
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            onChange={(e) => {
                              const currentIds = Array.isArray(view.columnIds) && view.columnIds.length > 0
                                ? view.columnIds
                                : columns.map((col) => col.id);
                              let nextIds;
                              if (e.target.checked) {
                                nextIds = Array.from(new Set([...currentIds, c.id]));
                              } else {
                                nextIds = currentIds.filter((id) => id !== c.id);
                                if (nextIds.length === 0) {
                                  alert("La vista debe incluir al menos una columna.");
                                  return;
                                }
                              }
                              handleUpdateView(view.id, { columnIds: nextIds });
                            }}
                          />
                          <span>{c.label} ({c.startTime})</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="visual-outline-button"
            style={{ marginTop: 14 }}
            onClick={handleAddView}
          >
            + Crear nueva vista de horarios
          </button>
        </div>
      )}

      {activeTab === "tags" && (
        <div className="signage-rooms-tags-manager">
          <p className="signage-rooms-subtext" style={{ marginBottom: 12 }}>
            Configura etiquetas visuales como KIDS, Conversation Club o Taller para resaltar actividades en la pantalla.
          </p>

          <div className="signage-rooms-tags-list">
            {tags.map((tag, idx) => (
              <div key={tag.id || idx} className="signage-rooms-tag-item-card">
                <span
                  className="signage-rooms-tag-chip"
                  style={{ backgroundColor: tag.backgroundColor, color: tag.color, fontSize: 13, padding: "6px 12px" }}
                >
                  {tag.name || "Muestra"}
                </span>
                <label className="signage-rooms-field" style={{ flex: 1 }}>
                  Nombre de etiqueta
                  <input
                    type="text"
                    value={tag.name || ""}
                    onChange={(e) => handleUpdateTag(tag.id, { name: e.target.value })}
                    placeholder="Ej. KIDS"
                  />
                </label>
                <label className="signage-rooms-field">
                  Color fondo
                  <input
                    type="color"
                    value={tag.backgroundColor || "#0284c7"}
                    onChange={(e) => handleUpdateTag(tag.id, { backgroundColor: e.target.value })}
                  />
                </label>
                <label className="signage-rooms-field">
                  Color texto
                  <input
                    type="color"
                    value={tag.color || "#ffffff"}
                    onChange={(e) => handleUpdateTag(tag.id, { color: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="visual-outline-button compact danger"
                  onClick={() => handleRemoveTag(tag.id)}
                  title="Eliminar etiqueta"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="visual-outline-button"
            style={{ marginTop: 14 }}
            onClick={handleAddTag}
          >
            + Agregar etiqueta
          </button>
        </div>
      )}
    </div>
  );
}
