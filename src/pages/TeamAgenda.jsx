import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
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


function TeamAgendaModuleIcon() {
  return (
    <svg className="module-topbar-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
      <path d="M8 14h3" />
      <path d="M13 14h3" />
      <path d="M8 18h3" />
    </svg>
  );
}

export default function TeamAgenda() {
  const { profile, isAdmin } = useAuth();
  const currentWeek = useMemo(() => getCurrentWeek(), []);
  const currentUserId = profile?.uid || profile?.id || "";

  const [teamUsers, setTeamUsers] = useState([]);
  const [workSchedules, setWorkSchedules] = useState([]);
  const [scheduleAdjustments, setScheduleAdjustments] = useState([]);
  const [requests, setRequests] = useState([]);
  const [attendanceLocations, setAttendanceLocations] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);

  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [loadingAdjustments, setLoadingAdjustments] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  const [loadError, setLoadError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingRequest, setSavingRequest] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState("");
  const [deletingRequestId, setDeletingRequestId] = useState("");
  const [adminComments, setAdminComments] = useState({});
  const [attendanceMessage, setAttendanceMessage] = useState("");

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

  const [locationForm, setLocationForm] = useState({
    name: "",
    latitude: "",
    longitude: "",
    allowedRadiusMeters: "150",
  });

  const [activePanel, setActivePanel] = useState("");

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
    if (!isAdmin) {
      setAttendanceLocations([]);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "attendanceLocations"),
      (snapshot) => {
        const locations = snapshot.docs
          .map((locationDoc) => ({
            id: locationDoc.id,
            ...locationDoc.data(),
          }))
          .sort((a, b) =>
            String(a.name || "").localeCompare(String(b.name || ""), "es")
          );

        setAttendanceLocations(locations);
      },
      (error) => {
        console.error("No se pudieron cargar las sedes de asistencia:", error);
        setLoadError(
          "No se pudieron cargar las sedes autorizadas. Revisa reglas para attendanceLocations."
        );
      }
    );

    return () => unsubscribe();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setWorkSessions([]);
      setLoadingAttendance(false);
      return undefined;
    }

    const weekStart = currentWeek[0]?.dateValue || getDateValue(new Date());
    const weekEnd = currentWeek[6]?.dateValue || getDateValue(new Date());

    setLoadingAttendance(true);

    const sessionsQuery = query(
      collection(db, "workSessions"),
      where("date", ">=", weekStart)
    );

    const unsubscribe = onSnapshot(
      sessionsQuery,
      (snapshot) => {
        const sessions = snapshot.docs
          .map((sessionDoc) => ({
            id: sessionDoc.id,
            ...sessionDoc.data(),
          }))
          .filter((session) => !session.date || session.date <= weekEnd)
          .sort((a, b) =>
            String(a.userName || "").localeCompare(String(b.userName || ""), "es")
          );

        setWorkSessions(sessions);
        setLoadingAttendance(false);
      },
      (error) => {
        console.error("No se pudieron cargar los registros de asistencia:", error);
        setLoadError(
          "No se pudieron cargar los registros de asistencia. Revisa reglas para workSessions."
        );
        setLoadingAttendance(false);
      }
    );

    return () => unsubscribe();
  }, [currentWeek, isAdmin]);

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

  const attendanceInsights = useMemo(
    () =>
      buildAttendanceInsights({
        team,
        workSessions,
        attendanceLocations,
        currentWeek,
      }),
    [attendanceLocations, currentWeek, team, workSessions]
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
    setActivePanel("base");

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

  function handleLocationFormChange(event) {
    const { name, value } = event.target;

    setAttendanceMessage("");
    setLocationForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleUseCurrentAdminLocation() {
    setAttendanceMessage("");

    if (!navigator.geolocation) {
      setAttendanceMessage("Este navegador no permite obtener ubicación.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationForm((current) => ({
          ...current,
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
        }));
        setAttendanceMessage("Ubicación actual cargada en el formulario.");
      },
      (error) => {
        console.error("No se pudo obtener la ubicación del administrador:", error);
        setAttendanceMessage(
          "No se pudo obtener tu ubicación. Puedes escribir latitud y longitud manualmente."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  }

  async function handleSaveAttendanceLocation(event) {
    event.preventDefault();

    if (!isAdmin) return;

    const latitude = Number(locationForm.latitude);
    const longitude = Number(locationForm.longitude);
    const allowedRadiusMeters = Number(locationForm.allowedRadiusMeters || 150);

    if (!locationForm.name.trim()) {
      setAttendanceMessage("Agrega el nombre de la sede.");
      return;
    }

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      setAttendanceMessage("Agrega latitud y longitud válidas.");
      return;
    }

    if (Number.isNaN(allowedRadiusMeters) || allowedRadiusMeters <= 0) {
      setAttendanceMessage("Agrega un radio permitido válido.");
      return;
    }

    try {
      await addDoc(collection(db, "attendanceLocations"), {
        name: locationForm.name.trim(),
        latitude,
        longitude,
        allowedRadiusMeters,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setLocationForm({
        name: "",
        latitude: "",
        longitude: "",
        allowedRadiusMeters: "150",
      });
      setAttendanceMessage("Sede autorizada guardada correctamente.");
    } catch (error) {
      console.error("No se pudo guardar la sede autorizada:", error);
      setAttendanceMessage(
        "No se pudo guardar la sede. Revisa reglas para attendanceLocations."
      );
    }
  }

  async function handleDeactivateAttendanceLocation(locationId) {
    if (!isAdmin || !locationId) return;

    const confirmed = window.confirm(
      "¿Quieres desactivar esta sede para el registro automático de jornada?"
    );

    if (!confirmed) return;

    try {
      await updateDoc(doc(db, "attendanceLocations", locationId), {
        isActive: false,
        updatedAt: serverTimestamp(),
      });
      setAttendanceMessage("Sede desactivada correctamente.");
    } catch (error) {
      console.error("No se pudo desactivar la sede:", error);
      setAttendanceMessage(
        "No se pudo desactivar la sede. Revisa reglas para attendanceLocations."
      );
    }
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


  async function deleteRequest(request) {
    if (!isAdmin || !request?.id) return;

    const confirmMessage =
      request.status === "approved" && request.type === "permanentScheduleChange"
        ? "¿Seguro que deseas eliminar esta solicitud? El horario base que ya fue aprobado no se revertirá automáticamente."
        : request.status === "approved"
          ? "¿Seguro que deseas eliminar esta solicitud? También se quitará el ajuste aprobado de la agenda."
          : "¿Seguro que deseas eliminar esta solicitud? Esta acción no se puede deshacer.";

    const confirmed = window.confirm(confirmMessage);

    if (!confirmed) return;

    setDeletingRequestId(request.id);
    setLoadError("");

    try {
      const batch = writeBatch(db);

      if (request.status === "approved" && request.type !== "permanentScheduleChange") {
        const adjustmentsQuery = query(
          collection(db, "scheduleAdjustments"),
          where("sourceRequestId", "==", request.id)
        );

        const adjustmentsSnapshot = await getDocs(adjustmentsQuery);

        adjustmentsSnapshot.forEach((adjustmentDoc) => {
          batch.delete(doc(db, "scheduleAdjustments", adjustmentDoc.id));
        });
      }

      batch.delete(doc(db, "scheduleRequests", request.id));

      batch.set(doc(collection(db, "scheduleLogs")), {
        requestId: request.id,
        action: "deleted",
        performedBy: currentUserId,
        performedByName: profile?.name || profile?.email || "Administrador",
        performedAt: serverTimestamp(),
        details:
          request.status === "approved" && request.type === "permanentScheduleChange"
            ? "Solicitud eliminada por administración. El horario base aprobado no fue revertido automáticamente."
            : request.status === "approved"
              ? "Solicitud eliminada por administración. También se eliminó el ajuste aprobado de la agenda."
              : "Solicitud eliminada por administración.",
      });

      await batch.commit();
    } catch (error) {
      console.error("No se pudo eliminar la solicitud:", error);
      setLoadError(
        "No se pudo eliminar la solicitud. Revisa reglas para scheduleRequests, scheduleAdjustments y scheduleLogs."
      );
    } finally {
      setDeletingRequestId("");
    }
  }

  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests]
  );

  const todayTeam = useMemo(() => {
    const todayKey = getTodayKey();

    return team
      .map((person) => ({
        ...person,
        todaySchedule: person.schedules[todayKey] || { status: "unset" },
      }))
      .sort((a, b) => {
        const order = {
          active: 0,
          normal: 1,
          approved: 1,
          pending: 2,
          permission: 3,
          absence: 3,
          rest: 4,
          dayOff: 4,
          unset: 5,
        };

        return (
          (order[a.todaySchedule?.status] ?? 9) -
            (order[b.todaySchedule?.status] ?? 9) ||
          String(a.name || "").localeCompare(String(b.name || ""), "es")
        );
      });
  }, [team]);

  const myVisibleRequests = isAdmin
    ? requests
    : requests.filter((request) => request.userId === currentUserId);

  return (
    <div className="team-agenda-page team-agenda-modern">
      <section className="module-topbar module-topbar-agenda">
        <div className="module-topbar-main">
          <span className="module-topbar-module-icon">
            <TeamAgendaModuleIcon />
          </span>

          <div className="module-topbar-copy">
            <p className="section-kicker module-topbar-kicker">Horarios y disponibilidad</p>
            <h1>Agenda del equipo</h1>
            <p>
              Consulta la semana laboral, revisa disponibilidad y da seguimiento a solicitudes de permisos, ausencias y cambios de horario.
            </p>
          </div>
        </div>

        <div className="module-topbar-side-card agenda-modern-week-card">
          <span className="agenda-modern-week-icon">📅</span>
          <div>
            <span>Semana actual</span>
            <strong>
              {currentWeek[0]?.shortDate} - {currentWeek[6]?.shortDate}
            </strong>
          </div>
        </div>
      </section>

      {loadError && <div className="team-agenda-alert agenda-modern-alert">{loadError}</div>}

      <section className="team-agenda-modern-summary">
        <ModernAgendaSummaryCard
          icon="👥"
          label="En turno ahora"
          value={summary.activeNow}
          detail="personas activas"
          tone="green"
        />

        <ModernAgendaSummaryCard
          icon="📅"
          label="Programados hoy"
          value={summary.normalToday}
          detail="con horario asignado"
          tone="blue"
        />

        <ModernAgendaSummaryCard
          icon="👤"
          label="Ausencias / permisos"
          value={summary.absences}
          detail="no disponibles hoy"
          tone="red"
        />

        <ModernAgendaSummaryCard
          icon="↔"
          label="Cambios pendientes"
          value={summary.pending}
          detail={isAdmin ? "solicitudes por revisar" : "tus solicitudes pendientes"}
          tone="yellow"
        />
      </section>

      <section className="agenda-modern-layout">
        <div className="agenda-modern-main-stack">
          <section className="agenda-modern-card agenda-weekly-card">
            <div className="agenda-modern-card-header">
              <div>
                <h3>Vista semanal del equipo</h3>
                <p>
                  {loading
                    ? "Cargando horarios reales del equipo..."
                    : "Horarios base y ajustes aprobados para esta semana."}
                </p>
              </div>

              <div className="agenda-modern-tools">
                <select aria-label="Filtrar colaboradores" defaultValue="all">
                  <option value="all">Todos los colaboradores</option>
                </select>
                <span>{team.length} colaborador(es)</span>
              </div>
            </div>

            {loading ? (
              <div className="team-agenda-empty">Cargando agenda del equipo...</div>
            ) : team.length === 0 ? (
              <div className="team-agenda-empty">
                No hay colaboradores activos registrados para mostrar en la agenda.
              </div>
            ) : (
              <div className="team-agenda-table-wrap agenda-modern-table-wrap">
                <table className="team-agenda-table agenda-modern-table">
                  <thead>
                    <tr>
                      <th>Colaborador</th>

                      {DAYS.map((day, index) => (
                        <th key={day.key}>
                          <span>{day.label.slice(0, 3)}</span>
                          <small>{currentWeek[index]?.shortDate}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {team.map((person) => (
                      <tr key={person.id}>
                        <td>
                          <div className="team-person-cell agenda-modern-person-cell">
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

            <div className="agenda-modern-legend">
              <span><i className="normal" /> Horario</span>
              <span><i className="active" /> En turno</span>
              <span><i className="permission" /> Permiso</span>
              <span><i className="absence" /> Ausencia</span>
              <span><i className="rest" /> Descanso</span>
            </div>
          </section>

          <section className="agenda-modern-card agenda-modern-quick-summary">
            <div className="agenda-modern-card-header compact">
              <div>
                <h3>Resumen rápido</h3>
                <p>Lo más importante de la semana sin saturar el tablero.</p>
              </div>
            </div>

            <div className="agenda-modern-quick-grid">
              <AgendaQuickCard
                icon="↗"
                label="Mayor cobertura"
                value={agendaInsights.busiestDay?.label || "Sin datos"}
                detail={
                  agendaInsights.busiestDay
                    ? `${agendaInsights.busiestDay.value} colaboradores programados`
                    : "Configura horarios para calcularlo"
                }
                tone="green"
              />

              <AgendaQuickCard
                icon="◷"
                label="Más horas esta semana"
                value={agendaInsights.topHoursPerson?.label || "Sin datos"}
                detail={
                  agendaInsights.topHoursPerson
                    ? `${formatHours(agendaInsights.topHoursPerson.value)} programadas`
                    : "Sin horarios suficientes"
                }
                tone="blue"
              />

              <AgendaQuickCard
                icon="📋"
                label="Solicitudes"
                value={`${pendingRequests.length} pendiente(s)`}
                detail={
                  pendingRequests.length > 0
                    ? "Requieren revisión administrativa"
                    : "Sin solicitudes por revisar"
                }
                tone="yellow"
              />
            </div>
          </section>

          <section className="agenda-modern-card agenda-modern-action-hub">
            <div className="agenda-modern-card-header compact agenda-modern-action-header">
              <div>
                <h3>Herramientas de agenda</h3>
                <p>
                  Accede a las acciones principales desde un panel más claro,
                  visual y fácil de abrir en vista enfocada.
                </p>
              </div>
            </div>

            <div className={`agenda-modern-action-grid ${isAdmin ? "is-admin" : "is-collaborator"}`}>
              <AgendaActionCard
                icon="↗"
                tone="blue"
                title="Solicitar cambio"
                detail="Permisos, ausencias, cambios temporales o ajustes permanentes."
                meta="Abrir solicitud"
                onOpen={() => setActivePanel("request")}
              />

              {isAdmin && (
                <AgendaActionCard
                  icon="⚙"
                  tone="violet"
                  title="Configurar horarios base"
                  detail="Asigna el horario regular por colaborador y día de la semana."
                  meta="Administración"
                  onOpen={() => setActivePanel("base")}
                />
              )}

              <AgendaActionCard
                icon="📋"
                tone="green"
                title={isAdmin ? "Historial de solicitudes" : "Mis solicitudes"}
                detail={
                  isAdmin
                    ? "Revisa, aprueba o rechaza solicitudes con comentarios administrativos."
                    : "Consulta el historial de tus solicitudes y sus comentarios."
                }
                meta={`${myVisibleRequests.length} registro(s)`}
                onOpen={() => setActivePanel("history")}
              />

              {isAdmin && (
                <AgendaActionCard
                  icon="📈"
                  tone="gold"
                  title="Indicadores y control de asistencia"
                  detail="Cobertura, sedes autorizadas y registros administrativos del equipo."
                  meta="Vista analítica"
                  onOpen={() => setActivePanel("insights")}
                />
              )}
            </div>
          </section>
        </div>

        <aside className="agenda-modern-side-stack">
          <section className="agenda-modern-card agenda-today-card">
            <div className="agenda-modern-side-header">
              <div>
                <h3>Equipo de hoy</h3>
                <p>Disponibilidad resumida</p>
              </div>
              <span>{summary.activeNow} en turno</span>
            </div>

            <div className="agenda-modern-team-list">
              {todayTeam.length === 0 ? (
                <div className="team-agenda-empty compact">Sin equipo programado hoy.</div>
              ) : (
                todayTeam.slice(0, 7).map((person) => (
                  <TodayTeamItem key={person.id} person={person} schedule={person.todaySchedule} />
                ))
              )}
            </div>
          </section>

          <section className="agenda-modern-card agenda-pending-card">
            <div className="agenda-modern-side-header">
              <div>
                <h3>{isAdmin ? "Solicitudes pendientes" : "Mis solicitudes"}</h3>
                <p>{isAdmin ? "Revisión administrativa" : "Seguimiento personal"}</p>
              </div>
              <span>{pendingRequests.length} pendiente(s)</span>
            </div>

            <div className="agenda-modern-pending-list">
              {loadingRequests ? (
                <div className="team-agenda-empty compact">Cargando solicitudes...</div>
              ) : (isAdmin ? pendingRequests : myVisibleRequests).length === 0 ? (
                <div className="team-agenda-empty compact">
                  {isAdmin ? "No hay solicitudes pendientes." : "Sin solicitudes registradas."}
                </div>
              ) : (
                (isAdmin ? pendingRequests : myVisibleRequests).slice(0, 5).map((request) => (
                  <CompactAgendaRequest key={request.id} request={request} isAdmin={isAdmin} />
                ))
              )}
            </div>
          </section>
        </aside>
      </section>

      {activePanel === "request" && (
        <FocusedAgendaPanel
          title="Solicitar cambio"
          description="Registra permisos, ausencias o ajustes de horario en una vista enfocada y más clara."
          badge="Vista enfocada"
          onClose={() => setActivePanel("")}
          sideContent={
            <AgendaFocusSummary
              title="Resumen rápido"
              description="Elige el tipo de ajuste y registra solo la información necesaria."
              items={[
                { icon: "📅", label: "Semana actual", value: `${currentWeek[0]?.shortDate || ""} - ${currentWeek[6]?.shortDate || ""}`, detail: "Periodo visible en agenda" },
                { icon: "⚡", label: "Autoaprobación", value: "Disponible", detail: "Asamblea, reunión o evento teocrático" },
                { icon: "📋", label: "Mis solicitudes", value: `${myVisibleRequests.length}`, detail: "Historial registrado" },
              ]}
              actions={[
                { label: isAdmin ? "Ver historial" : "Ver mis solicitudes", onClick: () => setActivePanel("history") },
              ]}
            />
          }
        >
          {requestMessage && (
            <div className="team-agenda-info-alert agenda-focused-alert">{requestMessage}</div>
          )}

          <section className="agenda-focused-section">
            <form className="team-agenda-form agenda-modern-form agenda-focused-form" onSubmit={handleSubmit}>
              <div className="team-agenda-form-row">
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
              </div>

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
                <div className="team-agenda-swap-box agenda-focused-block">
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
                <div className="team-agenda-swap-box permanent-schedule-box team-agenda-permanent-change-box agenda-focused-block">
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

              <div className="team-agenda-form-actions">
                <button
                  type="submit"
                  className="team-agenda-primary-button"
                  disabled={savingRequest}
                >
                  {savingRequest ? "Registrando..." : "Registrar solicitud"}
                </button>
              </div>
            </form>
          </section>
        </FocusedAgendaPanel>
      )}

      {activePanel === "base" && isAdmin && (
        <FocusedAgendaPanel
          title="Configurar horarios base"
          description="Define la asignación regular por colaborador y día en un panel más limpio."
          badge="Administración"
          onClose={() => setActivePanel("")}
          sideContent={
            <AgendaFocusSummary
              title="Configuración"
              description="Ajusta el horario regular sin mezclarlo con solicitudes temporales."
              items={[
                { icon: "👥", label: "Colaboradores", value: `${teamUsers.length}`, detail: "Activos en el sistema" },
                { icon: "📅", label: "Programados hoy", value: `${summary.scheduledToday}`, detail: "Con horario asignado" },
                { icon: "✅", label: "En turno ahora", value: `${summary.activeNow}`, detail: "Personas activas" },
              ]}
              actions={[
                { label: "Ver solicitudes", onClick: () => setActivePanel("history") },
              ]}
            />
          }
        >
          <section className="agenda-focused-section">
            <form className="team-agenda-form agenda-modern-form agenda-focused-form" onSubmit={handleSaveSchedule}>
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

              <label className="team-agenda-checkbox-label agenda-rest-toggle">
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
        </FocusedAgendaPanel>
      )}

      {activePanel === "history" && (
        <FocusedAgendaPanel
          title={isAdmin ? "Historial de solicitudes" : "Mis solicitudes"}
          description={
            isAdmin
              ? "Consulta, aprueba o revisa solicitudes desde una vista enfocada."
              : "Consulta el historial de tus solicitudes y sus comentarios administrativos."
          }
          badge={`${myVisibleRequests.length} registro(s)`}
          onClose={() => setActivePanel("")}
          sideContent={
            <AgendaFocusSummary
              title="Estado de solicitudes"
              description="Resumen para revisar pendientes y dar seguimiento sin saturar la agenda."
              items={[
                { icon: "🟡", label: "Pendientes", value: `${myVisibleRequests.filter((request) => request.status === "pending").length}`, detail: "Por revisar" },
                { icon: "🟢", label: "Aprobadas", value: `${myVisibleRequests.filter((request) => request.status === "approved").length}`, detail: "Ya reflejadas" },
                { icon: "🔴", label: "Rechazadas", value: `${myVisibleRequests.filter((request) => request.status === "rejected").length}`, detail: "Con respuesta administrativa" },
              ]}
              actions={[
                { label: "Registrar solicitud", onClick: () => setActivePanel("request") },
              ]}
            />
          }
        >
          <section className="agenda-focused-section">
            <div className="team-agenda-request-list agenda-modern-request-list agenda-focused-request-list">
              {loadingRequests ? (
                <div className="team-agenda-empty">
                  {isAdmin ? "Cargando solicitudes..." : "Cargando tus solicitudes..."}
                </div>
              ) : myVisibleRequests.length === 0 ? (
                <div className="team-agenda-empty">
                  {isAdmin
                    ? "No hay solicitudes registradas."
                    : "Todavía no tienes solicitudes registradas."}
                </div>
              ) : (
                myVisibleRequests.map((request) => (
                  <article key={request.id} className="team-agenda-request-card agenda-modern-request-card">
                    <div className="team-agenda-request-top">
                      <div>
                        <strong>{isAdmin ? request.userName : REQUEST_TYPES[request.type]}</strong>
                        <span>{isAdmin ? REQUEST_TYPES[request.type] : "Solicitud registrada por ti"}</span>
                      </div>

                      <StatusBadge status={request.status} />
                    </div>

                    <div className="team-agenda-request-info agenda-request-detail-info">
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
                      !isAdmin && request.status !== "pending" && (
                        <p className="team-agenda-admin-comment muted">
                          Sin comentario administrativo.
                        </p>
                      )
                    )}

                    {isAdmin && request.status === "pending" && (
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

                          <button
                            type="button"
                            className="danger subtle"
                            disabled={deletingRequestId === request.id}
                            onClick={() => deleteRequest(request)}
                          >
                            {deletingRequestId === request.id
                              ? "Eliminando..."
                              : "Eliminar"}
                          </button>
                        </div>
                      </>
                    )}

                    {isAdmin && request.status !== "pending" && (
                      <div className="team-agenda-request-actions">
                        <button
                          type="button"
                          className="danger subtle"
                          disabled={deletingRequestId === request.id}
                          onClick={() => deleteRequest(request)}
                        >
                          {deletingRequestId === request.id
                            ? "Eliminando..."
                            : "Eliminar solicitud"}
                        </button>
                      </div>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>
        </FocusedAgendaPanel>
      )}

      {activePanel === "insights" && isAdmin && (
        <FocusedAgendaPanel
          title="Indicadores y control de asistencia"
          description="Consulta cobertura, horas, solicitudes y sedes autorizadas desde una vista enfocada."
          badge="Vista analítica"
          onClose={() => setActivePanel("")}
          sideContent={
            <AgendaFocusSummary
              title="Resumen rápido"
              description={`Semana ${currentWeek[0]?.shortDate || ""} - ${currentWeek[6]?.shortDate || ""}`}
              items={[
                { icon: "📅", label: "Mayor cobertura", value: agendaInsights.busiestDay?.label || "Sin datos", detail: agendaInsights.busiestDay ? `${agendaInsights.busiestDay.value} colaboradores programados` : "Sin horarios suficientes" },
                { icon: "◷", label: "Más horas semanales", value: agendaInsights.topHoursPerson?.label || "Sin datos", detail: agendaInsights.topHoursPerson ? `${formatHours(agendaInsights.topHoursPerson.value)} programadas` : "Sin horas registradas" },
                { icon: "↔", label: "Cambios solicitados", value: `${pendingRequests.length}`, detail: "Solicitudes pendientes" },
                { icon: "✅", label: "Horas reales hoy", value: formatMinutesAsHours(attendanceInsights.realMinutesToday), detail: "Con inicio válido en sede" },
              ]}
              actions={[
                { label: "Registrar cambio temporal", onClick: () => setActivePanel("request") },
                { label: "Revisar solicitudes", onClick: () => setActivePanel("history") },
              ]}
            />
          }
        >
          <section className="agenda-focused-section agenda-focused-stacked-section agenda-attendance-focus-section">
            <AttendanceControlPanel
              insights={attendanceInsights}
              locations={attendanceLocations}
              loading={loadingAttendance}
              message={attendanceMessage}
              locationForm={locationForm}
              onLocationFormChange={handleLocationFormChange}
              onUseCurrentLocation={handleUseCurrentAdminLocation}
              onSaveLocation={handleSaveAttendanceLocation}
              onDeactivateLocation={handleDeactivateAttendanceLocation}
            />
          </section>
        </FocusedAgendaPanel>
      )}
    </div>
  );
}
function ModernAgendaSummaryCard({ icon, label, value, detail, tone }) {
  return (
    <article className={`agenda-modern-summary-card ${tone}`}>
      <span className="agenda-modern-summary-icon">{icon}</span>
      <div>
        <strong>{value}</strong>
        <h4>{label}</h4>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function AgendaQuickCard({ icon, label, value, detail, tone }) {
  return (
    <article className={`agenda-modern-quick-card ${tone}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function AgendaActionCard({ icon, tone = "blue", title, detail, meta, onOpen }) {
  return (
    <article className={`agenda-modern-action-card ${tone}`}>
      <div className="agenda-modern-action-top">
        <span className="agenda-modern-action-icon">{icon}</span>
        {meta && <b className="agenda-modern-action-meta">{meta}</b>}
      </div>

      <div className="agenda-modern-action-copy">
        <h4>{title}</h4>
        <p>{detail}</p>
      </div>

      <button type="button" className="agenda-modern-action-button" onClick={onOpen}>
        Abrir vista
      </button>
    </article>
  );
}

function AgendaFocusSummary({ title, description, items = [], actions = [] }) {
  return (
    <aside className="agenda-focus-sidebar">
      <div className="agenda-focus-sidebar-header">
        <span>☷</span>
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
      </div>

      <div className="agenda-focus-summary-list">
        {items.map((item) => (
          <article key={`${item.label}-${item.value}`} className="agenda-focus-summary-item">
            <span>{item.icon}</span>
            <div>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </div>
          </article>
        ))}
      </div>

      {actions.length > 0 && (
        <div className="agenda-focus-actions">
          <h4>Acciones rápidas</h4>
          {actions.map((action) => (
            <button key={action.label} type="button" onClick={action.onClick}>
              <span>↗</span>
              {action.label}
              <b>›</b>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function FocusedAgendaPanel({ title, description, badge, sideContent, onClose, children }) {
  return (
    <div className="agenda-focused-overlay" role="dialog" aria-modal="true">
      <div className={`agenda-focused-panel ${sideContent ? "with-sidebar" : ""}`}>
        <div className="agenda-focused-header">
          <div>
            <span className="agenda-focused-eyebrow">Agenda del equipo</span>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>

          <div className="agenda-focused-header-actions">
            {badge && <span className="agenda-focused-badge">{badge}</span>}
            <button type="button" className="agenda-focused-close-icon" onClick={onClose} aria-label="Cerrar panel">
              ×
            </button>
          </div>
        </div>

        <div className="agenda-focused-content">
          {sideContent}
          <main className="agenda-focused-main">{children}</main>
        </div>
      </div>
    </div>
  );
}

function TodayTeamItem({ person, schedule }) {
  const tone = getScheduleTone(schedule);

  return (
    <article className="agenda-modern-team-item">
      <div className="team-person-avatar agenda-modern-avatar">
        {getInitials(person.name)}
      </div>

      <div>
        <strong>{person.name}</strong>
        <span>{getScheduleTimeLabel(schedule)}</span>
      </div>

      <b className={`agenda-modern-status-pill ${tone}`}>
        {getScheduleShortStatus(schedule)}
      </b>
    </article>
  );
}

function CompactAgendaRequest({ request, isAdmin }) {
  return (
    <article className="agenda-modern-pending-item">
      <div className="team-person-avatar agenda-modern-avatar small">
        {getInitials(request.userName || REQUEST_TYPES[request.type])}
      </div>

      <div>
        <strong>{isAdmin ? request.userName : REQUEST_TYPES[request.type]}</strong>
        <span>{REQUEST_TYPES[request.type] || "Solicitud"}</span>
      </div>

      <div className="agenda-modern-pending-meta">
        <StatusBadge status={request.status} />
        <small>{formatDate(request.startDate)}</small>
      </div>
    </article>
  );
}

function getScheduleTone(schedule) {
  const status = schedule?.status || "unset";

  if (status === "active") return "green";
  if (status === "normal" || status === "approved") return "blue";
  if (status === "pending") return "yellow";
  if (status === "absence" || status === "permission") return "red";
  if (status === "rest" || status === "dayOff") return "gray";

  return "gray";
}

function getScheduleShortStatus(schedule) {
  const status = schedule?.status || "unset";

  if (status === "active") return "En turno";
  if (status === "normal" || status === "approved") return "Programado";
  if (status === "pending") return "Pendiente";
  if (status === "permission") return "Permiso";
  if (status === "absence") return "Ausente";
  if (status === "rest" || status === "dayOff") return "Descanso";

  return "Sin horario";
}

function getScheduleTimeLabel(schedule) {
  const status = schedule?.status || "unset";

  if (["rest", "dayOff"].includes(status)) return "Descanso";
  if (["absence", "permission"].includes(status)) return "No disponible";
  if (!schedule?.start || !schedule?.end) return "Sin horario asignado";

  return `${formatTime(schedule.start)} - ${formatTime(schedule.end)}`;
}

function AttendanceControlPanel({
  insights,
  locations,
  loading,
  message,
  locationForm,
  onLocationFormChange,
  onUseCurrentLocation,
  onSaveLocation,
  onDeactivateLocation,
}) {
  const activeLocations = locations.filter((location) => location.isActive !== false);
  const expectedMinutes = Number(insights.expectedMinutesToday || 0);
  const realMinutes = Number(insights.realMinutesToday || 0);
  const attendancePercent = expectedMinutes > 0
    ? Math.min(100, Math.round((realMinutes / expectedMinutes) * 100))
    : 0;
  const visibleRows = insights.rows.slice(0, 6);
  const visibleAlerts = insights.alerts.slice(0, 4);

  return (
    <section className="attendance-visual-panel">
      <div className="attendance-visual-intro">
        <div>
          <span className="attendance-visual-kicker">Control de asistencia</span>
          <h3>Estado de asistencia de hoy</h3>
          <p>
            Monitorea registros, sedes y alertas sin saturar la vista principal.
          </p>
        </div>
        <div className="attendance-visual-score-card">
          <span>Registro del día</span>
          <strong>{attendancePercent}%</strong>
          <div className="attendance-visual-progress-track">
            <div
              className="attendance-visual-progress-fill"
              style={{ width: `${attendancePercent}%` }}
            />
          </div>
          <small>{formatMinutesAsHours(realMinutes)} de {formatMinutesAsHours(expectedMinutes)}</small>
        </div>
      </div>

      <div className="attendance-visual-metrics">
        <AttendanceVisualMetric
          icon="◷"
          tone="blue"
          label="Horas esperadas"
          value={formatMinutesAsHours(expectedMinutes)}
          detail="Según la agenda vigente"
        />
        <AttendanceVisualMetric
          icon="✓"
          tone="green"
          label="Horas registradas"
          value={formatMinutesAsHours(realMinutes)}
          detail={`${attendancePercent}% del total esperado`}
        />
        <AttendanceVisualMetric
          icon="○"
          tone="gold"
          label="Sin registro"
          value={insights.missingCount}
          detail="Personas con horario hoy"
        />
        <AttendanceVisualMetric
          icon="!"
          tone="red"
          label="Alertas"
          value={insights.alerts.length}
          detail="Requieren atención"
        />
      </div>

      {message && <div className="team-agenda-info-alert attendance-visual-message">{message}</div>}

      <div className="attendance-visual-main-grid">
        <section className="attendance-visual-card attendance-visual-today-card">
          <div className="attendance-visual-card-header">
            <div>
              <span>📅</span>
              <h4>Asistencia de hoy</h4>
            </div>
            <small>{insights.rows.length} registro(s)</small>
          </div>

          {loading ? (
            <div className="team-agenda-empty compact">Cargando asistencia...</div>
          ) : insights.rows.length === 0 ? (
            <div className="team-agenda-empty compact">
              No hay colaboradores con horario para comparar hoy.
            </div>
          ) : (
            <div className="attendance-visual-row-list">
              {visibleRows.map((row) => (
                <article key={row.userId} className="attendance-visual-row-card">
                  <div className="team-person-avatar agenda-modern-avatar small">
                    {getInitials(row.userName)}
                  </div>
                  <div className="attendance-visual-row-person">
                    <strong>{row.userName}</strong>
                    <span>{row.area || "Sin área"}</span>
                  </div>
                  <div>
                    <small>Horario</small>
                    <b>{row.expectedLabel}</b>
                  </div>
                  <div>
                    <small>Registro</small>
                    <b>{row.checkInLabel}</b>
                  </div>
                  <div>
                    <small>Sede</small>
                    <b>{row.locationLabel}</b>
                  </div>
                  <span className={`attendance-status ${row.statusTone}`}>
                    {row.statusLabel}
                  </span>
                </article>
              ))}
              {insights.rows.length > visibleRows.length && (
                <p className="attendance-visual-more-note">
                  Mostrando {visibleRows.length} de {insights.rows.length} registros para mantener la vista limpia.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="attendance-visual-card attendance-visual-alerts-card">
          <div className="attendance-visual-card-header">
            <div>
              <span>🔔</span>
              <h4>Alertas por persona</h4>
            </div>
            <small>{insights.alerts.length} alerta(s)</small>
          </div>

          {visibleAlerts.length === 0 ? (
            <div className="attendance-visual-empty-mini">
              <strong>Sin alertas</strong>
              <span>Todo se ve en orden por ahora.</span>
            </div>
          ) : (
            <div className="attendance-visual-alert-list">
              {visibleAlerts.map((alert) => (
                <article key={`${alert.userId}-${alert.type}`} className="attendance-visual-alert-card">
                  <div className="team-person-avatar agenda-modern-avatar small">
                    {getInitials(alert.userName)}
                  </div>
                  <div>
                    <strong>{alert.userName}</strong>
                    <span>{alert.message}</span>
                  </div>
                  <i />
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="attendance-visual-locations-grid">
        <section className="attendance-visual-card attendance-visual-locations-card">
          <div className="attendance-visual-card-header">
            <div>
              <span>⌖</span>
              <h4>Sedes autorizadas</h4>
            </div>
            <small>{activeLocations.length} activa(s)</small>
          </div>

          {activeLocations.length === 0 ? (
            <div className="team-agenda-empty compact">
              No hay sedes autorizadas configuradas.
            </div>
          ) : (
            <div className="attendance-visual-location-list">
              {activeLocations.slice(0, 4).map((location) => (
                <article key={location.id} className="attendance-visual-location-card">
                  <div>
                    <span>🏢</span>
                    <div>
                      <strong>{location.name}</strong>
                      <small>Sede activa · Radio {location.allowedRadiusMeters || 150} m</small>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="team-agenda-danger-link"
                    onClick={() => onDeactivateLocation(location.id)}
                  >
                    Desactivar
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="attendance-visual-card attendance-visual-location-help-card">
          <div className="attendance-visual-card-header no-border">
            <div>
              <span>?</span>
              <h4>Asignacion de sede</h4>
            </div>
          </div>
          <p>
            No necesitas asignar una sede a cada persona. Las sedes activas funcionan como ubicaciones autorizadas generales:
            cuando alguien inicia jornada dentro del radio permitido de cualquier sede activa, ese tiempo se contabiliza.
          </p>
          <ul>
            <li>Agrega o actualiza sedes desde esta misma seccion.</li>
            <li>El colaborador debe permitir ubicacion al iniciar jornada.</li>
            <li>Si inicia fuera del radio, la asistencia aparece como alerta y no cuenta como jornada valida.</li>
          </ul>
        </section>

        <form className="attendance-visual-card attendance-visual-location-form" onSubmit={onSaveLocation}>
          <div className="attendance-visual-card-header no-border">
            <div>
              <span>＋</span>
              <h4>Agregar sede</h4>
            </div>
          </div>
          <p>
            Registra una nueva sede para que el sistema pueda validar el inicio de sesión.
          </p>

          <label>
            Nombre de la sede
            <input
              type="text"
              name="name"
              value={locationForm.name}
              onChange={onLocationFormChange}
              placeholder="Ej. Plaza Estrella"
              required
            />
          </label>

          <div className="attendance-visual-location-two-cols">
            <label>
              Latitud
              <input
                type="number"
                name="latitude"
                value={locationForm.latitude}
                onChange={onLocationFormChange}
                step="any"
                required
              />
            </label>
            <label>
              Longitud
              <input
                type="number"
                name="longitude"
                value={locationForm.longitude}
                onChange={onLocationFormChange}
                step="any"
                required
              />
            </label>
          </div>

          <label>
            Radio permitido en metros
            <input
              type="number"
              name="allowedRadiusMeters"
              value={locationForm.allowedRadiusMeters}
              onChange={onLocationFormChange}
              min="20"
              step="1"
              required
            />
          </label>

          <div className="attendance-visual-location-actions">
            <button type="button" onClick={onUseCurrentLocation}>
              Usar ubicación actual
            </button>
            <button type="submit" className="team-agenda-primary-button">
              Guardar sede
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function AttendanceVisualMetric({ icon, tone, label, value, detail }) {
  return (
    <article className={`attendance-visual-metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
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

function buildAttendanceInsights({ team, workSessions, attendanceLocations, currentWeek }) {
  const today = new Date();
  const todayDate = getDateValue(today);
  const todayKey = getTodayKey();
  const activeLocations = attendanceLocations.filter(
    (location) => location.isActive !== false
  );

  const todaySessionsByUser = workSessions.reduce((map, session) => {
    if (session.date !== todayDate || !session.userId) return map;

    const current = map[session.userId];
    const currentValue = current?.checkInMillis || current?.attemptedAtMillis || 0;
    const nextValue = session.checkInMillis || session.attemptedAtMillis || 0;

    if (!current || nextValue >= currentValue) {
      map[session.userId] = session;
    }

    return map;
  }, {});

  const rows = team
    .map((person) => {
      const schedule = person.schedules?.[todayKey];
      const expectedMinutes = getScheduleExpectedMinutes(schedule);
      const hasExpectedSchedule = expectedMinutes > 0;
      const session = todaySessionsByUser[person.id] || todaySessionsByUser[person.uid];
      const realMinutes = getSessionWorkedMinutes(session);
      const status = getAttendanceRowStatus({ session, hasExpectedSchedule });

      return {
        userId: person.id,
        userName: person.name,
        area: person.area || "Sin área",
        expectedMinutes,
        realMinutes,
        expectedLabel: hasExpectedSchedule
          ? `${formatTime(schedule.start)} - ${formatTime(schedule.end)}`
          : getNoExpectedScheduleLabel(schedule),
        checkInLabel: getSessionCheckInLabel(session),
        locationLabel: getSessionLocationLabel(session),
        statusLabel: status.label,
        statusTone: status.tone,
        alertMessage: status.alertMessage,
        alertType: status.alertType,
        shouldAlert: status.shouldAlert && hasExpectedSchedule,
      };
    })
    .filter((row) => row.expectedMinutes > 0 || row.realMinutes > 0 || row.statusTone !== "muted");

  const alerts = rows
    .filter((row) => row.shouldAlert)
    .map((row) => ({
      userId: row.userId,
      userName: row.userName,
      type: row.alertType,
      message: row.alertMessage,
    }));

  return {
    todayDate,
    activeLocationCount: activeLocations.length,
    expectedMinutesToday: rows.reduce((sum, row) => sum + row.expectedMinutes, 0),
    realMinutesToday: rows.reduce((sum, row) => sum + row.realMinutes, 0),
    missingCount: rows.filter((row) => row.statusTone === "danger" && row.alertType === "missing").length,
    lateCount: rows.filter((row) => row.alertType === "late").length,
    outsideLocationCount: rows.filter((row) => row.alertType === "outsideLocation").length,
    rows,
    alerts,
  };
}

function getScheduleExpectedMinutes(schedule) {
  if (!schedule || !schedule.start || !schedule.end) return 0;

  if (["rest", "unset", "absence", "permission", "dayOff"].includes(schedule.status)) {
    return 0;
  }

  const start = timeToMinutes(schedule.start);
  const end = timeToMinutes(schedule.end);

  if (start === null || end === null) return 0;

  if (end >= start) return end - start;

  return 24 * 60 - start + end;
}

function getNoExpectedScheduleLabel(schedule) {
  if (!schedule) return "Sin horario";

  if (schedule.status === "rest") return "Descanso";
  if (schedule.status === "permission") return "Permiso aprobado";
  if (schedule.status === "absence") return "Ausencia aprobada";
  if (schedule.status === "dayOff") return "Descanso aprobado";

  return "Sin horario";
}

function getSessionWorkedMinutes(session) {
  if (!session || !session.isCountedAsWorkTime || !session.checkInMillis) {
    return 0;
  }

  const endMillis =
    session.checkOutMillis ||
    session.effectiveEndMillis ||
    session.lastSeenMillis ||
    Date.now();

  const diffMinutes = Math.max(0, Math.round((endMillis - session.checkInMillis) / 60000));

  return diffMinutes;
}

function getAttendanceRowStatus({ session, hasExpectedSchedule }) {
  if (!hasExpectedSchedule && !session) {
    return {
      label: "Sin horario",
      tone: "muted",
      shouldAlert: false,
    };
  }

  if (!session) {
    return {
      label: "Sin registro",
      tone: "danger",
      shouldAlert: true,
      alertType: "missing",
      alertMessage: "Tiene horario hoy, pero no hay inicio válido de jornada.",
    };
  }

  if (!session.isCountedAsWorkTime) {
    const labels = {
      outsideLocation: "Fuera de sede",
      locationUnavailable: "Sin ubicación",
      locationDenied: "Ubicación negada",
      noLocationsConfigured: "Sin sedes configuradas",
      noSchedule: "Sin horario programado",
    };

    const alertMessages = {
      outsideLocation: "Inició sesión fuera del radio autorizado; no se contabilizó jornada.",
      locationUnavailable: "No se pudo validar ubicación; no se contabilizó jornada.",
      locationDenied: "No autorizó ubicación; no se contabilizó jornada.",
      noLocationsConfigured: "No hay sedes autorizadas configuradas para contabilizar jornada.",
      noSchedule: "Inició sesión en sede, pero no tenía horario programado hoy.",
    };

    const alertType = session.locationStatus || session.status || "notCounted";

    return {
      label: labels[alertType] || "No contabilizado",
      tone: alertType === "noSchedule" ? "warning" : "danger",
      shouldAlert: alertType !== "noSchedule",
      alertType,
      alertMessage: alertMessages[alertType] || "La jornada no se contabilizó.",
    };
  }

  if (
    session.isIdle ||
    session.countingStatus === "inactive" ||
    session.effectiveEndReason === "idle"
  ) {
    const idleLimit = session.idleLimitMinutes || 45;
    const endLabel = session.effectiveEndMillis
      ? formatTimeFromMillis(session.effectiveEndMillis)
      : "la última actividad real";

    return {
      label: "Detenida por inactividad",
      tone: "warning",
      shouldAlert: true,
      alertType: "idle",
      alertMessage: `La jornada se detuvo por más de ${idleLimit} minutos sin actividad. El tiempo se contabilizó hasta ${endLabel}.`,
    };
  }

  if ((session.minutesLate || 0) > 0) {
    return {
      label: `Tarde ${session.minutesLate} min`,
      tone: "warning",
      shouldAlert: true,
      alertType: "late",
      alertMessage: `Inició ${session.minutesLate} minutos después de su hora programada.`,
    };
  }

  return {
    label: session.countingStatus === "closed" ? "Jornada cerrada" : "A tiempo",
    tone: "success",
    shouldAlert: false,
  };
}

function getSessionCheckInLabel(session) {
  if (!session) return "Sin registro";

  return session.checkInTimeText || session.attemptedTimeText || "Registrado";
}

function getSessionLocationLabel(session) {
  if (!session) return "—";

  if (session.locationName) {
    const distance = Number(session.distanceMeters);
    return Number.isFinite(distance)
      ? `${session.locationName} (${Math.round(distance)} m)`
      : session.locationName;
  }

  const labels = {
    outsideLocation: "Fuera de sede",
    locationUnavailable: "Ubicación no disponible",
    locationDenied: "Ubicación negada",
    noLocationsConfigured: "Sin sedes configuradas",
  };

  return labels[session.locationStatus] || "—";
}

function formatTimeFromMillis(value) {
  if (!value) return "";

  return new Date(value).toLocaleTimeString("es-MX", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMinutesAsHours(minutes = 0) {
  if (!minutes) return "0 h";

  const rounded = Math.round((minutes / 60) * 10) / 10;
  return `${rounded} h`;
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
