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
  permanentScheduleChange: "Cambio permanente de horario base",
  temporarySwap: "Cambio temporal de día",
  dayOff: "Descanso solicitado",
  lateArrival: "Entrada tarde",
  earlyLeave: "Salida temprano",
};

const AUTO_APPROVAL_REASONS = {
  standard: "Revisión normal",
  assembly: "Asamblea",
  specialMeeting: "Reunión especial",
  theocraticEvent: "Evento teocrático",
};

const AUTO_APPROVAL_REASON_KEYS = [
  "assembly",
  "specialMeeting",
  "theocraticEvent",
];

const REQUEST_STATUS_LABELS = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};

const PRIVATE_REQUEST_MESSAGE =
  "Tu solicitud fue registrada. Administración la revisará. Los demás colaboradores no pueden ver los detalles de esta solicitud.";

const AUTO_APPROVED_REQUEST_MESSAGE =
  "Tu solicitud fue aprobada automáticamente por tratarse de un motivo autorizado. El ajuste ya se refleja en la agenda del equipo.";

const DEFAULT_PERMANENT_CHANGE_DAYS = DAYS.reduce((map, day) => {
  map[day.key] = {
    selected: false,
    isRestDay: false,
    startTime: "09:00",
    endTime: "17:00",
  };

  return map;
}, {});

function getDefaultPermanentChangeDays() {
  return DAYS.reduce((map, day) => {
    map[day.key] = { ...DEFAULT_PERMANENT_CHANGE_DAYS[day.key] };
    return map;
  }, {});
}

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
    autoApprovalReason: "standard",
    startDate: "",
    endDate: "",
    requestedStartTime: "",
    requestedEndTime: "",
    replacementDate: "",
    replacementStartTime: "",
    replacementEndTime: "",
    permanentChanges: getDefaultPermanentChangeDays(),
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
    if (!currentUserId) {
      setRequests([]);
      setLoadingRequests(false);
      return undefined;
    }

    setLoadingRequests(true);
    setLoadError("");

    const requestsCollection = collection(db, "scheduleRequests");
    const requestsQuery = isAdmin
      ? query(
          requestsCollection,
          where("status", "in", ["pending", "approved", "rejected", "cancelled"])
        )
      : query(requestsCollection, where("userId", "==", currentUserId));

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
          isAdmin
            ? "No se pudieron cargar las solicitudes. Revisa las reglas de Firestore para la colección scheduleRequests."
            : "No se pudieron cargar tus solicitudes. Revisa las reglas de Firestore para scheduleRequests."
        );
        setLoadingRequests(false);
      }
    );

    return () => unsubscribe();
  }, [currentUserId, isAdmin]);

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
      pending: requests.filter((request) => request.status === "pending").length,
    };
  }, [isAdmin, requests, scheduleAdjustments, team]);

  const agendaInsights = useMemo(
    () =>
      buildAgendaInsights({
        team,
        requests,
        scheduleAdjustments,
      }),
    [requests, scheduleAdjustments, team]
  );

  function handleChange(event) {
    const { name, value, type, checked } = event.target;

    setRequestMessage("");

    setFormData((current) => {
      const nextValue = type === "checkbox" ? checked : value;
      const nextData = {
        ...current,
        [name]: nextValue,
      };

      if (name === "type" && nextValue === "permanentScheduleChange") {
        nextData.autoApprovalReason = "standard";
      }

      return nextData;
    });
  }

  function handlePermanentDayChange(dayKey, field, value) {
    setRequestMessage("");

    setFormData((current) => ({
      ...current,
      permanentChanges: {
        ...(current.permanentChanges || getDefaultPermanentChangeDays()),
        [dayKey]: {
          ...((current.permanentChanges || getDefaultPermanentChangeDays())[dayKey] ||
            DEFAULT_PERMANENT_CHANGE_DAYS[dayKey]),
          [field]: value,
        },
      },
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

    if (formData.type === "temporarySwap") {
      if (formData.replacementDate === formData.startDate) {
        setRequestMessage(
          "Selecciona un día de reposición diferente al día que no podrás asistir."
        );
        return;
      }

      if (
        !formData.replacementDate ||
        !formData.replacementStartTime ||
        !formData.replacementEndTime
      ) {
        setRequestMessage(
          "Para un cambio temporal de día agrega la fecha de reposición y su horario."
        );
        return;
      }
    }

    if (formData.type === "permanentScheduleChange") {
      const selectedPermanentChanges = getSelectedPermanentChanges(formData);

      if (selectedPermanentChanges.length === 0) {
        setRequestMessage("Selecciona al menos un día de la semana para modificar.");
        return;
      }

      if (isAutoApprovalReason(formData.autoApprovalReason)) {
        setRequestMessage(
          "Los cambios permanentes al horario base siempre requieren aprobación administrativa."
        );
        return;
      }

      const invalidPermanentChange = selectedPermanentChanges.find(
        (change) => !change.isRestDay && (!change.startTime || !change.endTime)
      );

      if (invalidPermanentChange) {
        setRequestMessage(
          `Para ${getDayLabel(invalidPermanentChange.dayOfWeek)} agrega la nueva hora de entrada y salida, o marca el día como descanso.`
        );
        return;
      }
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
      const selectedPermanentChanges = getSelectedPermanentChanges(formData);
      const baseScheduleDay =
        formData.type === "permanentScheduleChange" && selectedPermanentChanges[0]
          ? selectedPermanentChanges[0].dayOfWeek
          : requestStartDay;
      const originalSchedule = scheduleMap[getScheduleKey(currentUserId, baseScheduleDay)];
      const permanentOriginalSchedule =
        formData.type === "permanentScheduleChange"
          ? getPermanentOriginalScheduleLabel({
              userId: currentUserId,
              changes: selectedPermanentChanges,
              scheduleMap,
            })
          : getOriginalScheduleLabel(originalSchedule);
      const selectedUser = teamUsers.find((user) => user.id === currentUserId);
      const autoApproved =
        formData.type !== "permanentScheduleChange" &&
        isAutoApprovalReason(formData.autoApprovalReason);
      const autoAdminComment = autoApproved
        ? getAutoApprovalAdminComment(formData.autoApprovalReason)
        : "";

      const requestPayload = {
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
        status: autoApproved ? "approved" : "pending",
        autoApprovalReason: formData.autoApprovalReason || "standard",
        autoApproved,
        startDate: formData.startDate,
        endDate: formData.endDate || formData.startDate,
        originalStartTime: originalSchedule?.startTime || "",
        originalEndTime: originalSchedule?.endTime || "",
        originalSchedule: permanentOriginalSchedule,
        requestedStartTime:
          formData.type === "permanentScheduleChange"
            ? selectedPermanentChanges[0]?.startTime || ""
            : formData.requestedStartTime || "",
        requestedEndTime:
          formData.type === "permanentScheduleChange"
            ? selectedPermanentChanges[0]?.endTime || ""
            : formData.requestedEndTime || "",
        replacementDate: formData.replacementDate || "",
        replacementStartTime: formData.replacementStartTime || "",
        replacementEndTime: formData.replacementEndTime || "",
        replacementSchedule: getReplacementScheduleLabel(formData),
        permanentChanges: selectedPermanentChanges,
        permanentDayOfWeek: selectedPermanentChanges[0]?.dayOfWeek || "",
        permanentIsRestDay: selectedPermanentChanges[0]?.isRestDay || false,
        requestedSchedule: getRequestedScheduleLabel({
          ...formData,
          permanentChanges: selectedPermanentChanges,
        }),
        reason: formData.reason.trim(),
        adminComment: autoAdminComment,
        reviewedAt: autoApproved ? serverTimestamp() : null,
        reviewedBy: autoApproved ? "system-auto" : null,
        reviewedByName: autoApproved ? "Aprobación automática" : null,
        requestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const requestRef = await addDoc(
        collection(db, "scheduleRequests"),
        requestPayload
      );

      if (autoApproved) {
        const approvedRequest = {
          id: requestRef.id,
          ...requestPayload,
        };

        const adjustmentPayloads = buildAdjustmentPayloads({
          request: approvedRequest,
          profile: { name: "Aprobación automática" },
          currentUserId: "system-auto",
        });

        await Promise.all(
          adjustmentPayloads.map((adjustment) =>
            setDoc(
              doc(db, "scheduleAdjustments", adjustment.id),
              {
                ...adjustment.payload,
                autoApproved: true,
                autoApprovalReason: formData.autoApprovalReason,
              }
            )
          )
        );

        await addDoc(collection(db, "scheduleLogs"), {
          requestId: requestRef.id,
          action: "autoApproved",
          performedBy: "system-auto",
          performedByName: "Aprobación automática",
          performedAt: serverTimestamp(),
          details: autoAdminComment,
          autoApproved: true,
          autoApprovalReason: formData.autoApprovalReason,
          adminComment: autoAdminComment,
        });
      }

      setFormData({
        type: "permission",
        autoApprovalReason: "standard",
        startDate: "",
        endDate: "",
        requestedStartTime: "",
        requestedEndTime: "",
        replacementDate: "",
        replacementStartTime: "",
        replacementEndTime: "",
        permanentChanges: getDefaultPermanentChangeDays(),
        reason: "",
      });

      setRequestMessage(
        autoApproved ? AUTO_APPROVED_REQUEST_MESSAGE : PRIVATE_REQUEST_MESSAGE
      );
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
        if (request.type === "permanentScheduleChange") {
          const permanentSchedules = buildPermanentSchedulePayloads({
            request,
            teamUsers,
            scheduleMap,
          });

          await Promise.all(
            permanentSchedules.map((permanentSchedule) =>
              setDoc(
                doc(db, "workSchedules", permanentSchedule.id),
                permanentSchedule.payload,
                { merge: true }
              )
            )
          );
        } else {
          const adjustmentPayloads = buildAdjustmentPayloads({
            request,
            profile,
            currentUserId,
          });

          await Promise.all(
            adjustmentPayloads.map((adjustment) =>
              setDoc(
                doc(db, "scheduleAdjustments", adjustment.id),
                adjustment.payload
              )
            )
          );
        }
      }

      await addDoc(collection(db, "scheduleLogs"), {
        requestId: request.id,
        action: nextStatus,
        performedBy: currentUserId,
        performedByName: profile?.name || profile?.email || "Administrador",
        performedAt: serverTimestamp(),
        details:
          nextStatus === "approved"
            ? request.type === "permanentScheduleChange"
              ? "Cambio permanente de horario base aprobado por administración."
              : "Solicitud aprobada por administración."
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
            cambios aprobados. Cada colaborador puede consultar el historial de
            sus propias solicitudes y comentarios administrativos.
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
              : "Tus solicitudes pendientes"
          }
          tone="yellow"
        />
      </section>

      {isAdmin && <AgendaInsights insights={agendaInsights} />}

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

      <div
        className={`team-agenda-bottom-grid ${
          formData.type === "permanentScheduleChange" ? "permanent-mode" : ""
        }`}
      >
        <section
          className={`team-agenda-card ${
            formData.type === "permanentScheduleChange" ? "team-agenda-card-wide" : ""
          }`}
        >
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

            <label>
              Motivo de autorización
              <select
                name="autoApprovalReason"
                value={formData.autoApprovalReason}
                onChange={handleChange}
                disabled={formData.type === "permanentScheduleChange"}
              >
                {Object.entries(AUTO_APPROVAL_REASONS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {formData.type !== "permanentScheduleChange" &&
              isAutoApprovalReason(formData.autoApprovalReason) && (
                <p className="team-agenda-auto-approval-note">
                  Esta solicitud se aprobará automáticamente por tratarse de un
                  motivo autorizado. El ajuste se reflejará en la agenda sin
                  modificar el horario permanente.
                </p>
              )}

            {formData.type === "permanentScheduleChange" && (
              <p className="team-agenda-auto-approval-note warning">
                Este tipo de solicitud siempre requiere aprobación administrativa
                porque modifica el horario base.
              </p>
            )}

            <div className="team-agenda-form-row">
              <label>
                {formData.type === "permanentScheduleChange"
                  ? "Fecha desde la que aplica"
                  : "Fecha inicial"}
                <input
                  type="date"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleChange}
                  required
                />
              </label>

              {formData.type !== "permanentScheduleChange" && (
                <label>
                  Fecha final
                  <input
                    type="date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleChange}
                  />
                </label>
              )}
            </div>

            {formData.type === "temporarySwap" && (
              <div className="team-agenda-swap-box">
                <strong>Cambio temporal de día</strong>
                <p>
                  Usa esta opción cuando no puedas asistir un día de esta semana
                  y quieras reponerlo en otro día sin modificar tu horario
                  permanente.
                </p>

                <div className="team-agenda-form-row">
                  <label>
                    Día que vas a reponer
                    <input
                      type="date"
                      name="replacementDate"
                      value={formData.replacementDate}
                      onChange={handleChange}
                      required={formData.type === "temporarySwap"}
                    />
                  </label>

                  <label>
                    Entrada de reposición
                    <input
                      type="time"
                      name="replacementStartTime"
                      value={formData.replacementStartTime}
                      onChange={handleChange}
                      required={formData.type === "temporarySwap"}
                    />
                  </label>
                </div>

                <div className="team-agenda-form-row">
                  <label>
                    Salida de reposición
                    <input
                      type="time"
                      name="replacementEndTime"
                      value={formData.replacementEndTime}
                      onChange={handleChange}
                      required={formData.type === "temporarySwap"}
                    />
                  </label>

                  <div className="team-agenda-swap-note">
                    El día inicial quedará como no disponible y el día de
                    reposición aparecerá como horario temporal aprobado.
                  </div>
                </div>
              </div>
            )}

            {formData.type === "permanentScheduleChange" && (
              <div className="team-agenda-swap-box permanent-schedule-box team-agenda-permanent-change-box">
                <strong>Cambio permanente de horario base</strong>
                <p>
                  Usa esta opción cuando quieras modificar tu horario regular.
                  Requiere aprobación administrativa y, al aprobarse, actualizará
                  los horarios siguientes sin afectar los ajustes temporales ya
                  registrados.
                </p>

                <div className="team-agenda-permanent-days-grid permanent-week-grid">
                  {DAYS.map((day) => {
                    const dayChange =
                      formData.permanentChanges?.[day.key] ||
                      DEFAULT_PERMANENT_CHANGE_DAYS[day.key];

                    return (
                      <div
                        key={day.key}
                        className={`team-agenda-permanent-day-card permanent-day-card ${dayChange.selected ? "selected" : ""}`}
                      >
                        <label className="team-agenda-permanent-day-header permanent-day-check">
                          <input
                            type="checkbox"
                            checked={dayChange.selected}
                            onChange={(event) =>
                              handlePermanentDayChange(
                                day.key,
                                "selected",
                                event.target.checked
                              )
                            }
                          />
                          <span>{day.label}</span>
                        </label>

                        <label className="team-agenda-permanent-day-rest team-agenda-checkbox-label permanent-checkbox">
                          <input
                            type="checkbox"
                            checked={dayChange.isRestDay}
                            disabled={!dayChange.selected}
                            onChange={(event) =>
                              handlePermanentDayChange(
                                day.key,
                                "isRestDay",
                                event.target.checked
                              )
                            }
                          />
                          Descanso fijo
                        </label>

                        <div className="team-agenda-permanent-day-fields permanent-day-times">
                          <label>
                            Entrada
                            <input
                              type="time"
                              value={dayChange.startTime}
                              disabled={!dayChange.selected || dayChange.isRestDay}
                              onChange={(event) =>
                                handlePermanentDayChange(
                                  day.key,
                                  "startTime",
                                  event.target.value
                                )
                              }
                            />
                          </label>

                          <label>
                            Salida
                            <input
                              type="time"
                              value={dayChange.endTime}
                              disabled={!dayChange.selected || dayChange.isRestDay}
                              onChange={(event) =>
                                handlePermanentDayChange(
                                  day.key,
                                  "endTime",
                                  event.target.value
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="team-agenda-swap-note">
                  Selecciona uno o varios días. Este cambio no se autoaprueba.
                  Cuando administración lo apruebe, se actualizarán solo los días
                  seleccionados del horario base para las siguientes semanas.
                </div>
              </div>
            )}

            {formData.type !== "temporarySwap" && formData.type !== "permanentScheduleChange" && (
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
            )}

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

                      {request.type === "temporarySwap" && request.replacementSchedule && (
                        <span>
                          <b>Reposición:</b> {request.replacementSchedule}
                        </span>
                      )}

                      {request.type === "permanentScheduleChange" && (
                        <span>
                          <b>Días base a modificar:</b>{" "}
                          {getPermanentChangesShortLabel(request)}
                        </span>
                      )}

                      {request.autoApprovalReason &&
                        request.autoApprovalReason !== "standard" && (
                          <span>
                            <b>Motivo autorizado:</b>{" "}
                            {getAutoApprovalReasonLabel(request.autoApprovalReason)}
                          </span>
                        )}

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

        {!isAdmin && (
          <section className="team-agenda-card">
            <div className="team-agenda-section-header">
              <div>
                <h3>Mis solicitudes</h3>
                <p>
                  Consulta el historial de tus solicitudes y los comentarios que
                  deje administración al aprobar o rechazar.
                </p>
              </div>
            </div>

            <div className="team-agenda-request-list">
              {loadingRequests ? (
                <div className="team-agenda-empty">Cargando tus solicitudes...</div>
              ) : requests.length === 0 ? (
                <div className="team-agenda-empty">
                  Todavía no tienes solicitudes registradas.
                </div>
              ) : (
                requests.map((request) => (
                  <article key={request.id} className="team-agenda-request-card">
                    <div className="team-agenda-request-top">
                      <div>
                        <strong>{REQUEST_TYPES[request.type]}</strong>
                        <span>Solicitud registrada por ti</span>
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

                      {request.type === "temporarySwap" && request.replacementSchedule && (
                        <span>
                          <b>Reposición:</b> {request.replacementSchedule}
                        </span>
                      )}

                      {request.type === "permanentScheduleChange" && (
                        <span>
                          <b>Días base a modificar:</b>{" "}
                          {getPermanentChangesShortLabel(request)}
                        </span>
                      )}

                      {request.autoApprovalReason &&
                        request.autoApprovalReason !== "standard" && (
                          <span>
                            <b>Motivo autorizado:</b>{" "}
                            {getAutoApprovalReasonLabel(request.autoApprovalReason)}
                          </span>
                        )}

                      {request.reviewedByName && (
                        <span>
                          <b>Revisó:</b> {request.reviewedByName}
                        </span>
                      )}
                    </div>

                    <p>{request.reason}</p>

                    {request.adminComment ? (
                      <p className="team-agenda-admin-comment">
                        <b>Comentario administrativo:</b> {request.adminComment}
                      </p>
                    ) : (
                      request.status !== "pending" && (
                        <p className="team-agenda-admin-comment muted">
                          Sin comentario administrativo.
                        </p>
                      )
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

function AgendaInsights({ insights }) {
  return (
    <section className="team-agenda-card agenda-insights-card">
      <div className="team-agenda-section-header">
        <div>
          <h3>Indicadores de agenda</h3>
          <p>
            Resumen administrativo de cobertura, horas programadas y patrones de
            solicitudes.
          </p>
        </div>
      </div>

      <div className="agenda-insights-grid">
        <InsightCard
          title="Día con mayor cobertura"
          value={insights.busiestDay?.label || "Sin datos"}
          detail={
            insights.busiestDay
              ? `${insights.busiestDay.value} colaboradores programados`
              : "Configura horarios para calcularlo"
          }
        />

        <InsightCard
          title="Más horas semanales"
          value={insights.topHoursPerson?.label || "Sin datos"}
          detail={
            insights.topHoursPerson
              ? `${formatHours(insights.topHoursPerson.value)} programadas`
              : "Sin horarios suficientes"
          }
        />

        <InsightCard
          title="Más ausencias / permisos"
          value={insights.topAbsencePerson?.label || "Sin datos"}
          detail={
            insights.topAbsencePerson
              ? `${insights.topAbsencePerson.value} ajustes aprobados`
              : "Sin ausencias aprobadas"
          }
        />

        <InsightCard
          title="Más cambios solicitados"
          value={insights.topChangePerson?.label || "Sin datos"}
          detail={
            insights.topChangePerson
              ? `${insights.topChangePerson.value} solicitudes de cambio`
              : "Sin cambios registrados"
          }
        />
      </div>

      <div className="agenda-charts-grid">
        <BarChart
          title="Cobertura por día"
          items={insights.coverageByDay}
          emptyText="Todavía no hay horarios programados."
        />

        <BarChart
          title="Horas por colaborador"
          items={insights.hoursByPerson}
          valueFormatter={formatHours}
          emptyText="Todavía no hay horas programadas."
        />

        <BarChart
          title="Solicitudes por tipo"
          items={insights.requestsByType}
          emptyText="Todavía no hay solicitudes registradas."
        />
      </div>
    </section>
  );
}

function InsightCard({ title, value, detail }) {
  return (
    <article className="agenda-insight-mini-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function BarChart({ title, items, valueFormatter = (value) => value, emptyText }) {
  const maxValue = Math.max(...items.map((item) => item.value), 0);

  return (
    <article className="agenda-chart-card">
      <h4>{title}</h4>

      {items.length === 0 || maxValue === 0 ? (
        <div className="team-agenda-empty compact">{emptyText}</div>
      ) : (
        <div className="agenda-chart-list">
          {items.map((item) => {
            const width = maxValue > 0 ? Math.max((item.value / maxValue) * 100, 7) : 0;

            return (
              <div key={item.key || item.label} className="agenda-chart-row">
                <span>{item.label}</span>

                <div className="agenda-chart-bar-track">
                  <div
                    className="agenda-chart-bar"
                    style={{ width: `${width}%` }}
                  />
                </div>

                <strong>{valueFormatter(item.value)}</strong>
              </div>
            );
          })}
        </div>
      )}
    </article>
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

function buildPermanentSchedulePayloads({ request, teamUsers, scheduleMap }) {
  const selectedUser = teamUsers.find((user) => user.id === request.userId);
  const changes = getRequestPermanentChanges(request);

  return changes.map((change) => {
    const dayOfWeek = change.dayOfWeek;
    const scheduleId = getScheduleKey(request.userId, dayOfWeek);
    const existingSchedule = scheduleMap[scheduleId];

    const payload = {
      userId: request.userId,
      userName: request.userName || selectedUser?.name || "Usuario sin nombre",
      userEmail: request.userEmail || selectedUser?.email || "",
      area: request.userArea || selectedUser?.area || "Sin área",
      role: selectedUser?.role || "collaborator",
      dayOfWeek,
      startTime: change.isRestDay ? "" : change.startTime || "",
      endTime: change.isRestDay ? "" : change.endTime || "",
      isRestDay: change.isRestDay || false,
      isActive: true,
      sourceRequestId: request.id,
      effectiveFromDate: request.startDate || "",
      updatedAt: serverTimestamp(),
    };

    if (!existingSchedule) {
      payload.createdAt = serverTimestamp();
    }

    return {
      id: scheduleId,
      payload,
    };
  });
}

function buildAdjustmentPayloads({ request, profile, currentUserId }) {
  if (request.type === "permanentScheduleChange") {
    return [];
  }

  const basePayload = {
    userId: request.userId,
    userName: request.userName || "Usuario sin nombre",
    userEmail: request.userEmail || "",
    userArea: request.userArea || "Sin área",
    type: request.type,
    sourceRequestId: request.id,
    isActive: true,
    approvedBy: currentUserId,
    approvedByName: profile?.name || profile?.email || "Administrador",
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (request.type === "temporarySwap") {
    return [
      {
        id: `${request.id}_original`,
        payload: {
          ...basePayload,
          publicStatus: "dayOff",
          startDate: request.startDate,
          endDate: request.startDate,
          startTime: "",
          endTime: "",
          displayLabel: "Día cambiado aprobado",
          replacementDate: request.replacementDate || "",
          replacementStartTime: request.replacementStartTime || "",
          replacementEndTime: request.replacementEndTime || "",
        },
      },
      {
        id: `${request.id}_replacement`,
        payload: {
          ...basePayload,
          publicStatus: "temporarySwap",
          startDate: request.replacementDate || request.startDate,
          endDate: request.replacementDate || request.startDate,
          startTime: request.replacementStartTime || "",
          endTime: request.replacementEndTime || "",
          displayLabel: "Reposición aprobada",
          originalDate: request.startDate,
        },
      },
    ];
  }

  const publicStatus = getPublicStatusFromRequestType(request.type);
  const isAvailabilityBlock = ["permission", "absence", "dayOff"].includes(
    publicStatus
  );

  return [
    {
      id: request.id,
      payload: {
        ...basePayload,
        publicStatus,
        startDate: request.startDate,
        endDate: request.endDate || request.startDate,
        startTime: isAvailabilityBlock ? "" : request.requestedStartTime || "",
        endTime: isAvailabilityBlock ? "" : request.requestedEndTime || "",
        displayLabel: getPublicAdjustmentLabel(publicStatus),
      },
    },
  ];
}

function isAutoApprovalReason(reason) {
  return AUTO_APPROVAL_REASON_KEYS.includes(reason);
}

function getAutoApprovalReasonLabel(reason) {
  return AUTO_APPROVAL_REASONS[reason] || AUTO_APPROVAL_REASONS.standard;
}

function getAutoApprovalAdminComment(reason) {
  return `Solicitud aprobada automáticamente por motivo autorizado: ${getAutoApprovalReasonLabel(reason)}.`;
}

function getPublicStatusFromRequestType(type) {
  if (type === "permission") return "permission";
  if (type === "absence") return "absence";
  if (type === "dayOff") return "dayOff";
  if (type === "lateArrival") return "lateArrival";
  if (type === "earlyLeave") return "earlyLeave";
  if (type === "temporarySwap") return "temporarySwap";

  return "scheduleChange";
}

function getPublicAdjustmentLabel(publicStatus) {
  const labels = {
    permission: "Permiso aprobado",
    absence: "Ausencia aprobada",
    dayOff: "Descanso aprobado",
    scheduleChange: "Cambio aprobado",
    temporarySwap: "Reposición aprobada",
    lateArrival: "Entrada tarde aprobada",
    earlyLeave: "Salida temprano aprobada",
  };

  return labels[publicStatus] || "Cambio aprobado";
}

function getSelectedPermanentChanges(data) {
  const changes = data?.permanentChanges || {};

  if (Array.isArray(changes)) {
    return changes
      .filter((change) => change?.dayOfWeek)
      .map((change) => ({
        dayOfWeek: change.dayOfWeek,
        isRestDay: Boolean(change.isRestDay),
        startTime: change.isRestDay ? "" : change.startTime || "",
        endTime: change.isRestDay ? "" : change.endTime || "",
      }));
  }

  return DAYS.filter((day) => changes[day.key]?.selected).map((day) => ({
    dayOfWeek: day.key,
    isRestDay: Boolean(changes[day.key]?.isRestDay),
    startTime: changes[day.key]?.isRestDay ? "" : changes[day.key]?.startTime || "",
    endTime: changes[day.key]?.isRestDay ? "" : changes[day.key]?.endTime || "",
  }));
}

function getRequestPermanentChanges(request) {
  if (Array.isArray(request?.permanentChanges) && request.permanentChanges.length > 0) {
    return getSelectedPermanentChanges(request);
  }

  if (request?.permanentDayOfWeek) {
    return [
      {
        dayOfWeek: request.permanentDayOfWeek,
        isRestDay: Boolean(request.permanentIsRestDay),
        startTime: request.permanentIsRestDay ? "" : request.requestedStartTime || "",
        endTime: request.permanentIsRestDay ? "" : request.requestedEndTime || "",
      },
    ];
  }

  return [];
}

function getPermanentOriginalScheduleLabel({ userId, changes, scheduleMap }) {
  if (!changes.length) return "Sin horario asignado";

  return changes
    .map((change) => {
      const originalSchedule = scheduleMap[getScheduleKey(userId, change.dayOfWeek)];
      return `${getDayLabel(change.dayOfWeek)}: ${getOriginalScheduleLabel(originalSchedule)}`;
    })
    .join(" · ");
}

function getPermanentChangesShortLabel(request) {
  const changes = getRequestPermanentChanges(request);

  if (changes.length === 0) return "Sin días seleccionados";

  return changes.map((change) => getDayLabel(change.dayOfWeek)).join(", ");
}

function getRequestedScheduleLabel(data) {
  if (data.type === "permanentScheduleChange") {
    const changes = Array.isArray(data.permanentChanges)
      ? data.permanentChanges
      : getSelectedPermanentChanges(data);

    if (changes.length === 0) {
      return "Cambio permanente de horario base";
    }

    return changes
      .map((change) => {
        const dayLabel = getDayLabel(change.dayOfWeek);

        if (change.isRestDay) {
          return `${dayLabel}: descanso fijo`;
        }

        if (change.startTime && change.endTime) {
          return `${dayLabel}: ${change.startTime} - ${change.endTime}`;
        }

        return `${dayLabel}: nuevo horario base`;
      })
      .join(" · ");
  }

  if (data.type === "temporarySwap") {
    return `No asistir el ${formatDate(data.startDate)} y reponer en otra fecha`;
  }

  if (data.requestedStartTime && data.requestedEndTime) {
    return `${data.requestedStartTime} - ${data.requestedEndTime}`;
  }

  return REQUEST_TYPES[data.type] || "Solicitud";
}

function getReplacementScheduleLabel(data) {
  if (data.type !== "temporarySwap") return "";

  const dateLabel = data.replacementDate
    ? formatDate(data.replacementDate)
    : "fecha por definir";

  const timeLabel =
    data.replacementStartTime && data.replacementEndTime
      ? `${data.replacementStartTime} - ${data.replacementEndTime}`
      : "horario por definir";

  return `${dateLabel}, ${timeLabel}`;
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

function getDayLabel(dayKey) {
  const day = DAYS.find((item) => item.key === dayKey);
  return day?.label || "Día no definido";
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

function buildAgendaInsights({ team, requests, scheduleAdjustments }) {
  const coverageByDay = DAYS.map((day) => {
    const value = team.filter((person) =>
      isWorkingSchedule(person.schedules?.[day.key])
    ).length;

    return {
      key: day.key,
      label: day.label,
      value,
    };
  });

  const hoursByPerson = team
    .map((person) => {
      const value = DAYS.reduce((total, day) => {
        const schedule = person.schedules?.[day.key];

        if (!isWorkingSchedule(schedule)) return total;

        return total + getScheduleHours(schedule);
      }, 0);

      return {
        key: person.id,
        label: person.name,
        value,
      };
    })
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  const absenceCounts = countByUser(
    scheduleAdjustments.filter((adjustment) =>
      ["permission", "absence", "dayOff"].includes(
        adjustment.publicStatus || adjustment.type
      )
    )
  );

  const changeCounts = countByUser(
    requests.filter((request) =>
      ["scheduleChange", "permanentScheduleChange", "temporarySwap", "lateArrival", "earlyLeave"].includes(request.type)
    )
  );

  const requestsByType = Object.entries(REQUEST_TYPES)
    .map(([type, label]) => ({
      key: type,
      label,
      value: requests.filter((request) => request.type === type).length,
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  return {
    coverageByDay,
    hoursByPerson,
    requestsByType,
    busiestDay: getTopItem(coverageByDay),
    topHoursPerson: getTopItem(hoursByPerson),
    topAbsencePerson: getTopItem(absenceCounts),
    topChangePerson: getTopItem(changeCounts),
  };
}

function isWorkingSchedule(schedule) {
  if (!schedule) return false;

  return ["normal", "active", "approved"].includes(schedule.status)
    && Boolean(schedule.start)
    && Boolean(schedule.end);
}

function getScheduleHours(schedule) {
  const startMinutes = timeToMinutes(schedule.start);
  const endMinutes = timeToMinutes(schedule.end);

  if (startMinutes === null || endMinutes === null) return 0;

  if (endMinutes >= startMinutes) {
    return (endMinutes - startMinutes) / 60;
  }

  return (24 * 60 - startMinutes + endMinutes) / 60;
}

function countByUser(items) {
  const counts = new Map();

  items.forEach((item) => {
    const userId = item.userId || item.id || item.userName;
    if (!userId) return;

    const current = counts.get(userId) || {
      key: userId,
      label: item.userName || item.name || "Usuario sin nombre",
      value: 0,
    };

    current.value += 1;
    counts.set(userId, current);
  });

  return [...counts.values()].sort((a, b) => b.value - a.value);
}

function getTopItem(items) {
  const sorted = [...items].filter((item) => item.value > 0).sort((a, b) => b.value - a.value);

  return sorted[0] || null;
}

function formatHours(value) {
  if (!value) return "0 h";

  const rounded = Math.round(value * 10) / 10;

  return `${rounded} h`;
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
