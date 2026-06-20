import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/AuthContext";

const DAYS = [
  { key: "monday", label: "Lunes" },
  { key: "tuesday", label: "Martes" },
  { key: "wednesday", label: "Miércoles" },
  { key: "thursday", label: "Jueves" },
  { key: "friday", label: "Viernes" },
  { key: "saturday", label: "Sábado" },
  { key: "sunday", label: "Domingo" },
];

const STATUS_LABELS = {
  normal: "Horario normal",
  active: "En turno",
  rest: "Descanso",
  unset: "Sin horario",
  pending: "Cambio pendiente",
  approved: "Cambio aprobado",
  absence: "Ausente",
  permission: "Permiso aprobado",
  dayOff: "Descanso aprobado",
};

const REQUEST_TYPES = {
  permission: "Permiso",
  absence: "Ausencia",
  scheduleChange: "Cambio de horario",
  dayOff: "Descanso solicitado",
  lateArrival: "Entrada tarde",
  earlyLeave: "Salida temprano",
};

const REQUEST_STATUS_LABELS = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};

const PRIVATE_REQUEST_MESSAGE =
  "Tu solicitud fue registrada. Administración la revisará. Los demás colaboradores no pueden ver los detalles de esta solicitud.";

export default function TeamAgenda() {
  const { profile, isAdmin } = useAuth();
  const currentWeek = useMemo(() => getCurrentWeek(), []);
  const currentUserId = profile?.uid || profile?.id || "";

  const [teamUsers, setTeamUsers] = useState([]);
  const [workSchedules, setWorkSchedules] = useState([]);
  const [scheduleAdjustments, setScheduleAdjustments] = useState([]);
  const [requests, setRequests] = useState([]);

  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [loadingAdjustments, setLoadingAdjustments] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(false);

  const [loadError, setLoadError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingRequest, setSavingRequest] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState("");
  const [adminComments, setAdminComments] = useState({});

  const [formData, setFormData] = useState({
    type: "permission",
    startDate: "",
    endDate: "",
    requestedStartTime: "",
    requestedEndTime: "",
    reason: "",
  });

  const [scheduleForm, setScheduleForm] = useState({
    userId: "",
    dayOfWeek: "monday",
    startTime: "09:00",
    endTime: "17:00",
    isRestDay: false,
  });

  useEffect(() => {
    setLoadingUsers(true);
    setLoadError("");

    const unsubscribe = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        const users = snapshot.docs
          .map((userDoc) => normalizeUser(userDoc.id, userDoc.data()))
          .filter((user) => user.active !== false)
          .sort((a, b) => a.name.localeCompare(b.name, "es"));

        setTeamUsers(users);
        setLoadingUsers(false);
      },
      (error) => {
        console.error("No se pudieron cargar los usuarios:", error);
        setLoadError(
          "No se pudieron cargar los colaboradores. Revisa las reglas de Firestore para la colección users."
        );
        setLoadingUsers(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setLoadingSchedules(true);
    setLoadError("");

    const unsubscribe = onSnapshot(
      collection(db, "workSchedules"),
      (snapshot) => {
        const schedules = snapshot.docs.map((scheduleDoc) => ({
          id: scheduleDoc.id,
          ...scheduleDoc.data(),
        }));

        setWorkSchedules(schedules);
        setLoadingSchedules(false);
      },
      (error) => {
        console.error("No se pudieron cargar los horarios:", error);
        setLoadError(
          "No se pudieron cargar los horarios. Revisa las reglas de Firestore para la colección workSchedules."
        );
        setLoadingSchedules(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setLoadingAdjustments(true);
    setLoadError("");

    const unsubscribe = onSnapshot(
      collection(db, "scheduleAdjustments"),
      (snapshot) => {
        const adjustments = snapshot.docs
          .map((adjustmentDoc) => ({
            id: adjustmentDoc.id,
            ...adjustmentDoc.data(),
          }))
          .filter((adjustment) => adjustment.isActive !== false);

        setScheduleAdjustments(adjustments);
        setLoadingAdjustments(false);
      },
      (error) => {
        console.error("No se pudieron cargar los ajustes aprobados:", error);
        setLoadError(
          "No se pudieron cargar los cambios aprobados. Revisa las reglas de Firestore para la colección scheduleAdjustments."
        );
        setLoadingAdjustments(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setRequests([]);
      setLoadingRequests(false);
      return undefined;
    }

    setLoadingRequests(true);
    setLoadError("");

    const requestsQuery = query(
      collection(db, "scheduleRequests"),
      where("status", "in", ["pending", "approved", "rejected"])
    );

    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        const requestList = snapshot.docs
          .map((requestDoc) => ({
            id: requestDoc.id,
            ...requestDoc.data(),
          }))
          .sort((a, b) => getRequestSortValue(b) - getRequestSortValue(a));

        setRequests(requestList);
        setLoadingRequests(false);
      },
      (error) => {
        console.error("No se pudieron cargar las solicitudes:", error);
        setLoadError(
          "No se pudieron cargar las solicitudes. Revisa las reglas de Firestore para la colección scheduleRequests."
        );
        setLoadingRequests(false);
      }
    );

    return () => unsubscribe();
  }, [isAdmin]);

  useEffect(() => {
    if (!scheduleForm.userId && teamUsers.length > 0) {
      setScheduleForm((current) => ({
        ...current,
        userId: teamUsers[0].id,
      }));
    }
  }, [scheduleForm.userId, teamUsers]);

  const scheduleMap = useMemo(() => {
    return workSchedules.reduce((map, schedule) => {
      if (!schedule.userId || !schedule.dayOfWeek) return map;

      map[getScheduleKey(schedule.userId, schedule.dayOfWeek)] = schedule;
      return map;
    }, {});
  }, [workSchedules]);

  const adjustmentMap = useMemo(() => {
    const map = {};

    scheduleAdjustments.forEach((adjustment) => {
      if (!adjustment.userId || !adjustment.startDate) return;

      currentWeek.forEach((day) => {
        if (isDateInRangeValue(day.dateValue, adjustment.startDate, adjustment.endDate)) {
          map[getAdjustmentKey(adjustment.userId, day.dateValue)] = adjustment;
        }
      });
    });

    return map;
  }, [currentWeek, scheduleAdjustments]);

  const team = useMemo(() => {
    return teamUsers.map((user) => {
      const schedules = DAYS.reduce((map, day, index) => {
        const dateValue = currentWeek[index]?.dateValue || "";
        const savedSchedule = scheduleMap[getScheduleKey(user.id, day.key)];
        const adjustment = adjustmentMap[getAdjustmentKey(user.id, dateValue)];

        map[day.key] = buildScheduleForDisplay({
          savedSchedule,
          dayOfWeek: day.key,
          adjustment,
        });

        return map;
      }, {});

      return {
        ...user,
        schedules,
      };
    });
  }, [adjustmentMap, currentWeek, scheduleMap, teamUsers]);

  const loading = loadingUsers || loadingSchedules || loadingAdjustments;

  const summary = useMemo(() => {
    const todayKey = getTodayKey();
    const todayDate = getDateValue(new Date());
    const todaySchedules = team.map((person) => ({
      ...person,
      today: person.schedules[todayKey],
    }));

    return {
      activeNow: todaySchedules.filter((item) =>
        isScheduleActiveNow(item.today)
      ).length,
      normalToday: todaySchedules.filter((item) =>
        ["normal", "active", "approved"].includes(item.today?.status)
      ).length,
      absences: scheduleAdjustments.filter(
        (adjustment) =>
          ["absence", "permission", "dayOff"].includes(adjustment.publicStatus) &&
          isDateInRangeValue(todayDate, adjustment.startDate, adjustment.endDate)
      ).length,
      pending: isAdmin
        ? requests.filter((request) => request.status === "pending").length
        : "—",
    };
  }, [isAdmin, requests, scheduleAdjustments, team]);

  function handleChange(event) {
    const { name, value } = event.target;

    setRequestMessage("");

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleScheduleChange(event) {
    const { name, value, type, checked } = event.target;

    setSaveMessage("");

    setScheduleForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function handleSelectSchedule(userId, dayOfWeek) {
    const savedSchedule = scheduleMap[getScheduleKey(userId, dayOfWeek)];

    setSaveMessage("");

    setScheduleForm({
      userId,
      dayOfWeek,
      startTime: savedSchedule?.startTime || "09:00",
      endTime: savedSchedule?.endTime || "17:00",
      isRestDay: savedSchedule?.isRestDay || false,
    });
  }

  function handleAdminCommentChange(requestId, value) {
    setAdminComments((current) => ({
      ...current,
      [requestId]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!currentUserId) {
      setRequestMessage("No se pudo identificar tu usuario. Vuelve a iniciar sesión.");
      return;
    }

    if (!formData.startDate) {
      setRequestMessage("Selecciona la fecha inicial de la solicitud.");
      return;
    }

    if (requiresRequestedSchedule(formData.type)) {
      if (!formData.requestedStartTime || !formData.requestedEndTime) {
        setRequestMessage(
          "Para este tipo de solicitud agrega la nueva hora de entrada y salida."
        );
        return;
      }
    }

    setSavingRequest(true);
    setRequestMessage("");

    try {
      const requestStartDay = getDayKeyFromDateValue(formData.startDate);
      const originalSchedule = scheduleMap[getScheduleKey(currentUserId, requestStartDay)];
      const selectedUser = teamUsers.find((user) => user.id === currentUserId);

      await addDoc(collection(db, "scheduleRequests"), {
        userId: currentUserId,
        userName:
          profile?.name || selectedUser?.name || profile?.email || "Usuario sin nombre",
        userEmail: profile?.email || selectedUser?.email || "",
        userArea:
          profile?.area ||
          profile?.department ||
          selectedUser?.area ||
          "Sin área",
        type: formData.type,
        status: "pending",
        startDate: formData.startDate,
        endDate: formData.endDate || formData.startDate,
        originalStartTime: originalSchedule?.startTime || "",
        originalEndTime: originalSchedule?.endTime || "",
        originalSchedule: getOriginalScheduleLabel(originalSchedule),
        requestedStartTime: formData.requestedStartTime || "",
        requestedEndTime: formData.requestedEndTime || "",
        requestedSchedule: getRequestedScheduleLabel(formData),
        reason: formData.reason.trim(),
        adminComment: "",
        reviewedAt: null,
        reviewedBy: null,
        reviewedByName: null,
        requestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setFormData({
        type: "permission",
        startDate: "",
        endDate: "",
        requestedStartTime: "",
        requestedEndTime: "",
        reason: "",
      });

      setRequestMessage(PRIVATE_REQUEST_MESSAGE);
    } catch (error) {
      console.error("No se pudo registrar la solicitud:", error);
      setRequestMessage(
        "No se pudo registrar la solicitud. Revisa las reglas de Firestore para scheduleRequests."
      );
    } finally {
      setSavingRequest(false);
    }
  }

  async function handleSaveSchedule(event) {
    event.preventDefault();

    if (!isAdmin) return;

    const selectedUser = teamUsers.find((user) => user.id === scheduleForm.userId);

    if (!selectedUser) {
      setSaveMessage("Selecciona un colaborador válido.");
      return;
    }

    if (
      !scheduleForm.isRestDay &&
      (!scheduleForm.startTime || !scheduleForm.endTime)
    ) {
      setSaveMessage(
        "Agrega hora de entrada y salida, o marca el día como descanso."
      );
      return;
    }

    setSavingSchedule(true);
    setSaveMessage("");

    try {
      const scheduleId = getScheduleKey(
        scheduleForm.userId,
        scheduleForm.dayOfWeek
      );

      const existingSchedule = scheduleMap[scheduleId];

      const payload = {
        userId: selectedUser.id,
        userName: selectedUser.name,
        userEmail: selectedUser.email || "",
        area: selectedUser.area || "Sin área",
        role: selectedUser.role || "collaborator",
        dayOfWeek: scheduleForm.dayOfWeek,
        startTime: scheduleForm.isRestDay ? "" : scheduleForm.startTime,
        endTime: scheduleForm.isRestDay ? "" : scheduleForm.endTime,
        isRestDay: scheduleForm.isRestDay,
        isActive: true,
        updatedAt: serverTimestamp(),
      };

      if (!existingSchedule) {
        payload.createdAt = serverTimestamp();
      }

      await setDoc(doc(db, "workSchedules", scheduleId), payload, {
        merge: true,
      });

      setSaveMessage("Horario guardado correctamente.");
    } catch (error) {
      console.error("No se pudo guardar el horario:", error);
      setSaveMessage(
        "No se pudo guardar el horario. Revisa permisos de Firestore."
      );
    } finally {
      setSavingSchedule(false);
    }
  }

  async function reviewRequest(request, nextStatus) {
    if (!isAdmin || !request?.id) return;

    const adminComment = (adminComments[request.id] || "").trim();

    setReviewingRequestId(request.id);

    try {
      const requestRef = doc(db, "scheduleRequests", request.id);

      await updateDoc(requestRef, {
        status: nextStatus,
        adminComment,
        reviewedAt: serverTimestamp(),
        reviewedBy: currentUserId,
        reviewedByName: profile?.name || profile?.email || "Administrador",
        updatedAt: serverTimestamp(),
      });

      if (nextStatus === "approved") {
        await setDoc(
          doc(db, "scheduleAdjustments", request.id),
          buildAdjustmentPayload({ request, profile, currentUserId })
        );
      }

      await addDoc(collection(db, "scheduleLogs"), {
        requestId: request.id,
        action: nextStatus,
        performedBy: currentUserId,
        performedByName: profile?.name || profile?.email || "Administrador",
        performedAt: serverTimestamp(),
        details:
          nextStatus === "approved"
            ? "Solicitud aprobada por administración."
            : "Solicitud rechazada por administración.",
        adminComment,
      });

      setAdminComments((current) => ({
        ...current,
        [request.id]: "",
      }));
    } catch (error) {
      console.error("No se pudo actualizar la solicitud:", error);
      setLoadError(
        "No se pudo actualizar la solicitud. Revisa reglas para scheduleRequests, scheduleAdjustments y scheduleLogs."
      );
    } finally {
      setReviewingRequestId("");
    }
  }

  return (
    <div className="team-agenda-page">
      <div className="team-agenda-header">
        <div>
          <span className="team-agenda-eyebrow">Horarios y disponibilidad</span>
          <h2>Agenda del equipo</h2>
          <p>
            Consulta los horarios del equipo completo, ausencias, permisos y
            cambios aprobados. Los detalles de las solicitudes solo los puede ver
            administración.
          </p>
        </div>

        <div className="team-agenda-week-pill">
          Semana actual
          <strong>
            {currentWeek[0]?.shortDate} - {currentWeek[6]?.shortDate}
          </strong>
        </div>
      </div>

      {loadError && <div className="team-agenda-alert">{loadError}</div>}

      <section className="team-agenda-summary-grid">
        <SummaryCard
          label="En turno ahora"
          value={summary.activeNow}
          detail="Personas activas en este momento"
          tone="green"
        />

        <SummaryCard
          label="Programados hoy"
          value={summary.normalToday}
          detail="Con horario asignado para hoy"
          tone="blue"
        />

        <SummaryCard
          label="Ausencias / permisos"
          value={summary.absences}
          detail="No disponibles el día de hoy"
          tone="red"
        />

        <SummaryCard
          label="Cambios pendientes"
          value={summary.pending}
          detail={
            isAdmin
              ? "Solicitudes por revisar"
              : "Solo administración puede revisar solicitudes"
          }
          tone="yellow"
        />
      </section>

      <section className="team-agenda-card">
        <div className="team-agenda-section-header">
          <div>
            <h3>Vista semanal</h3>
            <p>
              {loading
                ? "Cargando horarios reales del equipo..."
                : "Resumen visual de horarios por colaborador."}
            </p>
          </div>

          <div className="team-agenda-legend">
            <span className="legend-dot normal" /> Normal
            <span className="legend-dot active" /> En turno
            <span className="legend-dot pending" /> Pendiente
            <span className="legend-dot absence" /> Ausente
            <span className="legend-dot rest" /> Descanso
          </div>
        </div>

        {loading ? (
          <div className="team-agenda-empty">Cargando agenda del equipo...</div>
        ) : team.length === 0 ? (
          <div className="team-agenda-empty">
            No hay colaboradores activos registrados para mostrar en la agenda.
          </div>
        ) : (
          <div className="team-agenda-table-wrap">
            <table className="team-agenda-table">
              <thead>
                <tr>
                  <th>Colaborador</th>

                  {DAYS.map((day, index) => (
                    <th key={day.key}>
                      <span>{day.label}</span>
                      <small>{currentWeek[index]?.shortDate}</small>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {team.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <div className="team-person-cell">
                        <div className="team-person-avatar">
                          {getInitials(person.name)}
                        </div>

                        <div>
                          <strong>{person.name}</strong>
                          <span>{person.area}</span>
                        </div>
                      </div>
                    </td>

                    {DAYS.map((day) => {
                      const schedule = person.schedules[day.key];

                      return (
                        <td key={day.key}>
                          <ScheduleCell
                            schedule={schedule}
                            canEdit={isAdmin}
                            onEdit={() =>
                              handleSelectSchedule(person.id, day.key)
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="team-agenda-card">
          <div className="team-agenda-section-header">
            <div>
              <h3>Configurar horarios base</h3>
              <p>
                Asigna el horario regular de cada colaborador. Los cambios se
                guardan en Firebase en la colección workSchedules.
              </p>
            </div>
          </div>

          <form className="team-agenda-form" onSubmit={handleSaveSchedule}>
            <div className="team-agenda-form-row agenda-admin-row">
              <label>
                Colaborador
                <select
                  name="userId"
                  value={scheduleForm.userId}
                  onChange={handleScheduleChange}
                  required
                >
                  {teamUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} — {user.area || "Sin área"}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Día
                <select
                  name="dayOfWeek"
                  value={scheduleForm.dayOfWeek}
                  onChange={handleScheduleChange}
                  required
                >
                  {DAYS.map((day) => (
                    <option key={day.key} value={day.key}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Hora de entrada
                <input
                  type="time"
                  name="startTime"
                  value={scheduleForm.startTime}
                  onChange={handleScheduleChange}
                  disabled={scheduleForm.isRestDay}
                />
              </label>

              <label>
                Hora de salida
                <input
                  type="time"
                  name="endTime"
                  value={scheduleForm.endTime}
                  onChange={handleScheduleChange}
                  disabled={scheduleForm.isRestDay}
                />
              </label>
            </div>

            <label className="team-agenda-checkbox-label">
              <input
                type="checkbox"
                name="isRestDay"
                checked={scheduleForm.isRestDay}
                onChange={handleScheduleChange}
              />
              Marcar este día como descanso
            </label>

            <div className="team-agenda-form-actions">
              <button
                type="submit"
                className="team-agenda-primary-button"
                disabled={savingSchedule || teamUsers.length === 0}
              >
                {savingSchedule ? "Guardando..." : "Guardar horario"}
              </button>

              {saveMessage && <span>{saveMessage}</span>}
            </div>
          </form>
        </section>
      )}

      <div className="team-agenda-bottom-grid">
        <section className="team-agenda-card">
          <div className="team-agenda-section-header">
            <div>
              <h3>Solicitar cambio</h3>
              <p>
                Registra un permiso, ausencia o cambio de horario. La solicitud
                solo será visible para administración.
              </p>
            </div>
          </div>

          <form className="team-agenda-form" onSubmit={handleSubmit}>
            <label>
              Tipo de solicitud
              <select name="type" value={formData.type} onChange={handleChange}>
                {Object.entries(REQUEST_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="team-agenda-form-row">
              <label>
                Fecha inicial
                <input
                  type="date"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleChange}
                  required
                />
              </label>

              <label>
                Fecha final
                <input
                  type="date"
                  name="endDate"
                  value={formData.endDate}
                  onChange={handleChange}
                />
              </label>
            </div>

            <div className="team-agenda-form-row">
              <label>
                Nueva entrada
                <input
                  type="time"
                  name="requestedStartTime"
                  value={formData.requestedStartTime}
                  onChange={handleChange}
                />
              </label>

              <label>
                Nueva salida
                <input
                  type="time"
                  name="requestedEndTime"
                  value={formData.requestedEndTime}
                  onChange={handleChange}
                />
              </label>
            </div>

            <label>
              Motivo
              <textarea
                name="reason"
                value={formData.reason}
                onChange={handleChange}
                placeholder="Describe brevemente el motivo de la solicitud."
                rows="4"
                required
              />
            </label>

            <button
              type="submit"
              className="team-agenda-primary-button"
              disabled={savingRequest}
            >
              {savingRequest ? "Registrando..." : "Registrar solicitud"}
            </button>

            {requestMessage && (
              <p className="team-agenda-form-note strong-note">
                {requestMessage}
              </p>
            )}
          </form>
        </section>

        {isAdmin && (
          <section className="team-agenda-card">
            <div className="team-agenda-section-header">
              <div>
                <h3>Solicitudes por revisar</h3>
                <p>
                  Solo administradores pueden ver el detalle, aprobar o rechazar
                  solicitudes.
                </p>
              </div>
            </div>

            <div className="team-agenda-request-list">
              {loadingRequests ? (
                <div className="team-agenda-empty">Cargando solicitudes...</div>
              ) : requests.length === 0 ? (
                <div className="team-agenda-empty">
                  No hay solicitudes registradas.
                </div>
              ) : (
                requests.map((request) => (
                  <article key={request.id} className="team-agenda-request-card">
                    <div className="team-agenda-request-top">
                      <div>
                        <strong>{request.userName}</strong>
                        <span>{REQUEST_TYPES[request.type]}</span>
                      </div>

                      <StatusBadge status={request.status} />
                    </div>

                    <div className="team-agenda-request-info">
                      <span>
                        <b>Fecha:</b> {formatDate(request.startDate)}
                        {request.endDate && request.endDate !== request.startDate
                          ? ` - ${formatDate(request.endDate)}`
                          : ""}
                      </span>

                      <span>
                        <b>Horario actual:</b> {request.originalSchedule}
                      </span>

                      <span>
                        <b>Solicitado:</b> {request.requestedSchedule}
                      </span>

                      {request.reviewedByName && (
                        <span>
                          <b>Revisó:</b> {request.reviewedByName}
                        </span>
                      )}
                    </div>

                    <p>{request.reason}</p>

                    {request.adminComment && (
                      <p className="team-agenda-admin-comment">
                        <b>Comentario administrativo:</b> {request.adminComment}
                      </p>
                    )}

                    {request.status === "pending" && (
                      <>
                        <label className="team-agenda-admin-comment-box">
                          Comentario administrativo opcional
                          <textarea
                            value={adminComments[request.id] || ""}
                            onChange={(event) =>
                              handleAdminCommentChange(
                                request.id,
                                event.target.value
                              )
                            }
                            rows="2"
                            placeholder="Puedes dejar un comentario interno o explicación para el colaborador."
                          />
                        </label>

                        <div className="team-agenda-request-actions">
                          <button
                            type="button"
                            disabled={reviewingRequestId === request.id}
                            onClick={() => reviewRequest(request, "approved")}
                          >
                            {reviewingRequestId === request.id
                              ? "Procesando..."
                              : "Aprobar"}
                          </button>

                          <button
                            type="button"
                            className="danger"
                            disabled={reviewingRequestId === request.id}
                            onClick={() => reviewRequest(request, "rejected")}
                          >
                            Rechazar
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail, tone }) {
  return (
    <article className={`team-agenda-summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function ScheduleCell({ schedule, canEdit, onEdit }) {
  const status = schedule?.status || "unset";

  if (status === "rest" || status === "dayOff") {
    return (
      <div className="schedule-cell rest">
        <strong>{schedule?.displayLabel || STATUS_LABELS[status] || "Descanso"}</strong>
        {schedule?.source === "adjustment" && <span>Cambio aprobado</span>}

        {canEdit && schedule?.source !== "adjustment" && (
          <button type="button" className="schedule-cell-edit" onClick={onEdit}>
            Editar
          </button>
        )}
      </div>
    );
  }

  if (status === "unset") {
    return (
      <div className="schedule-cell unset">
        <strong>Sin horario</strong>
        <span>{canEdit ? "Configurar" : "No asignado"}</span>

        {canEdit && (
          <button type="button" className="schedule-cell-edit" onClick={onEdit}>
            Editar
          </button>
        )}
      </div>
    );
  }

  if (status === "absence" || status === "permission") {
    return (
      <div className={`schedule-cell ${status}`}>
        <strong>{schedule?.displayLabel || STATUS_LABELS[status]}</strong>
        <span>No disponible</span>

        {canEdit && schedule?.source !== "adjustment" && (
          <button type="button" className="schedule-cell-edit" onClick={onEdit}>
            Editar
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`schedule-cell ${status}`}>
      <strong>
        {formatTime(schedule.start)} - {formatTime(schedule.end)}
      </strong>
      <span>{schedule?.displayLabel || STATUS_LABELS[status]}</span>

      {canEdit && schedule?.source !== "adjustment" && (
        <button type="button" className="schedule-cell-edit" onClick={onEdit}>
          Editar
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`team-agenda-status-badge ${status}`}>
      {REQUEST_STATUS_LABELS[status] || status}
    </span>
  );
}

function buildScheduleForDisplay({ savedSchedule, dayOfWeek, adjustment }) {
  if (adjustment) {
    return buildAdjustmentSchedule(adjustment);
  }

  if (!savedSchedule || savedSchedule.isActive === false) {
    return { status: "unset" };
  }

  if (savedSchedule.isRestDay) {
    return {
      ...savedSchedule,
      status: "rest",
    };
  }

  const start = savedSchedule.startTime || "";
  const end = savedSchedule.endTime || "";

  if (!start || !end) {
    return {
      ...savedSchedule,
      status: "unset",
    };
  }

  return {
    ...savedSchedule,
    start,
    end,
    status:
      dayOfWeek === getTodayKey() && isNowBetween(start, end)
        ? "active"
        : "normal",
  };
}

function buildAdjustmentSchedule(adjustment) {
  const publicStatus = adjustment.publicStatus || adjustment.type;

  if (["permission", "absence", "dayOff"].includes(publicStatus)) {
    return {
      ...adjustment,
      status: publicStatus,
      source: "adjustment",
      displayLabel: adjustment.displayLabel || getPublicAdjustmentLabel(publicStatus),
    };
  }

  const start = adjustment.startTime || "";
  const end = adjustment.endTime || "";

  return {
    ...adjustment,
    start,
    end,
    status: "approved",
    source: "adjustment",
    displayLabel: adjustment.displayLabel || "Cambio aprobado",
  };
}

function buildAdjustmentPayload({ request, profile, currentUserId }) {
  const publicStatus = getPublicStatusFromRequestType(request.type);
  const isAvailabilityBlock = ["permission", "absence", "dayOff"].includes(
    publicStatus
  );

  return {
    userId: request.userId,
    userName: request.userName || "Usuario sin nombre",
    userEmail: request.userEmail || "",
    userArea: request.userArea || "Sin área",
    type: request.type,
    publicStatus,
    startDate: request.startDate,
    endDate: request.endDate || request.startDate,
    startTime: isAvailabilityBlock ? "" : request.requestedStartTime || "",
    endTime: isAvailabilityBlock ? "" : request.requestedEndTime || "",
    displayLabel: getPublicAdjustmentLabel(publicStatus),
    sourceRequestId: request.id,
    isActive: true,
    approvedBy: currentUserId,
    approvedByName: profile?.name || profile?.email || "Administrador",
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function getPublicStatusFromRequestType(type) {
  if (type === "permission") return "permission";
  if (type === "absence") return "absence";
  if (type === "dayOff") return "dayOff";
  if (type === "lateArrival") return "lateArrival";
  if (type === "earlyLeave") return "earlyLeave";

  return "scheduleChange";
}

function getPublicAdjustmentLabel(publicStatus) {
  const labels = {
    permission: "Permiso aprobado",
    absence: "Ausencia aprobada",
    dayOff: "Descanso aprobado",
    scheduleChange: "Cambio aprobado",
    lateArrival: "Entrada tarde aprobada",
    earlyLeave: "Salida temprano aprobada",
  };

  return labels[publicStatus] || "Cambio aprobado";
}

function getRequestedScheduleLabel(data) {
  if (data.requestedStartTime && data.requestedEndTime) {
    return `${data.requestedStartTime} - ${data.requestedEndTime}`;
  }

  return REQUEST_TYPES[data.type] || "Solicitud";
}

function getOriginalScheduleLabel(schedule) {
  if (!schedule || schedule.isActive === false) return "Sin horario asignado";
  if (schedule.isRestDay) return "Descanso";
  if (schedule.startTime && schedule.endTime) {
    return `${schedule.startTime} - ${schedule.endTime}`;
  }

  return "Sin horario asignado";
}

function requiresRequestedSchedule(type) {
  return ["scheduleChange", "lateArrival", "earlyLeave"].includes(type);
}

function isScheduleActiveNow(schedule) {
  if (!schedule) return false;

  if (schedule.status === "active") return true;

  if (schedule.status === "approved" && schedule.start && schedule.end) {
    return isNowBetween(schedule.start, schedule.end);
  }

  return false;
}

function normalizeUser(id, data = {}) {
  return {
    id: data.uid || id,
    docId: id,
    uid: data.uid || id,
    name:
      data.name ||
      data.displayName ||
      data.fullName ||
      data.email ||
      "Usuario sin nombre",
    email: data.email || "",
    area: data.area || data.department || data.departmentName || "Sin área",
    role: data.role || data.privilege || "collaborator",
    active: data.active,
  };
}

function getScheduleKey(userId, dayOfWeek) {
  return `${String(userId).replaceAll("/", "_")}_${dayOfWeek}`;
}

function getAdjustmentKey(userId, dateValue) {
  return `${String(userId).replaceAll("/", "_")}_${dateValue}`;
}

function getCurrentWeek() {
  const today = new Date();
  const day = today.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(today);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(today.getDate() + diffToMonday);

  return DAYS.map((_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);

    return {
      date,
      dateValue: getDateValue(date),
      shortDate: date.toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
      }),
    };
  });
}

function getTodayKey() {
  const keys = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  return keys[new Date().getDay()];
}

function getDayKeyFromDateValue(value) {
  const date = new Date(`${value}T12:00:00`);
  return getDayKeyFromDate(date);
}

function getDayKeyFromDate(date) {
  const keys = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  return keys[date.getDay()];
}

function isNowBetween(startTime, endTime) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) return false;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

function timeToMinutes(value = "") {
  const [hours, minutes] = value.split(":").map(Number);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  return hours * 60 + minutes;
}

function formatTime(value = "") {
  if (!value) return "";

  const [hours, minutes] = value.split(":");
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);

  return date.toLocaleTimeString("es-MX", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(value) {
  if (!value) return "Sin fecha";

  const date = new Date(`${value}T12:00:00`);

  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isDateInRangeValue(dateValue, startDate, endDate) {
  if (!dateValue || !startDate) return false;

  const start = startDate;
  const end = endDate || startDate;

  return dateValue >= start && dateValue <= end;
}

function getRequestSortValue(request) {
  const value =
    request.requestedAt?.toMillis?.() ||
    request.updatedAt?.toMillis?.() ||
    request.reviewedAt?.toMillis?.();

  if (value) return value;

  if (request.startDate) {
    return new Date(`${request.startDate}T12:00:00`).getTime();
  }

  return 0;
}

function getInitials(name = "") {
  const initials = String(name)
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "U";
}
