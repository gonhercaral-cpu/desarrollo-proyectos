import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { normalizeRole } from "../utils/departmentMembership";

const AuthContext = createContext();
const ATTENDANCE_TOLERANCE_MINUTES = 10;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_LIMIT_MINUTES = 45;
const IDLE_LIMIT_MS = IDLE_LIMIT_MINUTES * 60 * 1000;
const ACTIVITY_EVENTS = [
  "click",
  "keydown",
  "scroll",
  "mousemove",
  "touchstart",
  "focus",
];

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSession, setActiveSession] = useState(null);
  const activeSessionRef = useRef(null);
  const lastRealActivityMillisRef = useRef(Date.now());

  async function loadUserProfile(user) {
    if (!user?.uid) {
      return null;
    }

    const userRef = doc(db, "users", user.uid);
    const userSnapshot = await getDoc(userRef);

    if (!userSnapshot.exists()) {
      console.warn(
        "No existe un documento en Firestore para este UID:",
        user.uid
      );

      return null;
    }

    return {
      id: userSnapshot.id,
      uid: user.uid,
      ...userSnapshot.data(),
    };
  }

  async function refreshProfile() {
    if (!firebaseUser) {
      setProfile(null);
      return null;
    }

    const updatedProfile = await loadUserProfile(firebaseUser);
    setProfile(updatedProfile);

    return updatedProfile;
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setLoading(true);

      try {
        setFirebaseUser(user);

        if (user) {
          const userProfile = await loadUserProfile(user);
          setProfile(userProfile);

          if (userProfile?.active === true) {
            registerAutomaticWorkSession(userProfile).catch((error) => {
              console.error("No se pudo registrar asistencia automática:", error);
            });
          }
        } else {
          setProfile(null);
          setActiveSession(null);
        }
      } catch (error) {
        console.error("Error cargando perfil del usuario:", error);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!firebaseUser?.uid) return undefined;

    return onSnapshot(
      doc(db, "users", firebaseUser.uid),
      (userSnapshot) => {
        setProfile(userSnapshot.exists()
          ? { id: userSnapshot.id, uid: firebaseUser.uid, ...userSnapshot.data() }
          : null);
      },
      (error) => {
        console.error("Error sincronizando el perfil del usuario:", error);
      }
    );
  }, [firebaseUser?.uid]);

  useEffect(() => {
    if (!firebaseUser?.uid) {
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "users"), where("active", "==", true)),
      (snapshot) => {
        setUsers(
          snapshot.docs.map((userDoc) => ({
            id: userDoc.id,
            uid: userDoc.id,
            ...userDoc.data(),
          }))
        );
      },
      (error) => {
        console.error("Error sincronizando el directorio de usuarios:", error);
        setUsers([]);
      }
    );
  }, [firebaseUser?.uid]);

  const directoryUsers = useMemo(() => {
    if (!profile) return users;

    const profileId = profile.uid || profile.id;
    const hasCurrentProfile = users.some(
      (user) => user.id === profileId || user.uid === profileId
    );

    return hasCurrentProfile ? users : [profile, ...users];
  }, [profile, users]);


  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    if (!activeSession?.id) return undefined;

    const registerRealActivity = () => {
      const nowMillis = Date.now();
      const lastRealActivityMillis =
        lastRealActivityMillisRef.current ||
        activeSessionRef.current?.lastRealActivityMillis ||
        nowMillis;

      if (nowMillis - lastRealActivityMillis >= IDLE_LIMIT_MS) {
        return;
      }

      lastRealActivityMillisRef.current = nowMillis;
    };

    registerRealActivity();

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, registerRealActivity, {
        passive: true,
      });
    });

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, registerRealActivity);
      });
    };
  }, [activeSession?.id]);

  useEffect(() => {
    if (!activeSession?.id) return undefined;

    const interval = window.setInterval(() => {
      updateWorkSessionHeartbeat(activeSession).catch((error) => {
        console.error("No se pudo actualizar actividad de jornada:", error);
      });
    }, HEARTBEAT_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [activeSession]);

  async function registerAutomaticWorkSession(userProfile) {
    const userId = userProfile.uid || userProfile.id;

    if (!userId) return null;

    const today = new Date();
    const dateValue = getDateValue(today);
    const dayKey = getTodayKey(today);
    const sessionId = `${sanitizeId(userId)}_${dateValue}`;
    const sessionRef = doc(db, "workSessions", sessionId);
    const nowMillis = Date.now();
    const nowTimeText = formatTimeFromDate(new Date(nowMillis));

    const [expectedSchedule, attendanceLocations, currentLocation] = await Promise.all([
      getExpectedScheduleForToday(userId, dayKey, dateValue),
      getActiveAttendanceLocations(),
      getCurrentBrowserLocationSafe(),
    ]);

    const existingSnapshot = await getDoc(sessionRef).catch(() => null);
    const existingData = existingSnapshot?.exists?.() ? existingSnapshot.data() : null;
    const existingIsInactive = Boolean(
      existingData?.isIdle ||
        existingData?.countingStatus === "inactive" ||
        existingData?.effectiveEndMillis
    );

    const locationResult = getLocationValidationResult({
      currentLocation,
      attendanceLocations,
    });

    const hasExpectedSchedule = Boolean(expectedSchedule?.startTime && expectedSchedule?.endTime);
    const expectedMinutes = hasExpectedSchedule
      ? getMinutesBetween(expectedSchedule.startTime, expectedSchedule.endTime)
      : 0;

    const minutesLate = hasExpectedSchedule
      ? Math.max(0, Math.round((nowMillis - getDateTimeMillis(dateValue, expectedSchedule.startTime)) / 60000) - ATTENDANCE_TOLERANCE_MINUTES)
      : 0;

    const canCountAsWorkTime = Boolean(
      hasExpectedSchedule && locationResult.locationStatus === "insideLocation"
    );

    const basePayload = {
      userId,
      userName: userProfile.name || userProfile.email || "Usuario",
      userEmail: userProfile.email || "",
      area: userProfile.area || userProfile.department || userProfile.departmentName || "Sin área",
      role: userProfile.role || "collaborator",
      date: dateValue,
      dayOfWeek: dayKey,
      scheduledStartTime: expectedSchedule?.startTime || "",
      scheduledEndTime: expectedSchedule?.endTime || "",
      expectedMinutes,
      scheduleStatus: expectedSchedule?.status || "noSchedule",
      locationStatus: locationResult.locationStatus,
      locationName: locationResult.locationName || "",
      latitude: currentLocation?.latitude ?? null,
      longitude: currentLocation?.longitude ?? null,
      accuracyMeters: currentLocation?.accuracy ?? null,
      distanceMeters: locationResult.distanceMeters ?? null,
      isCountedAsWorkTime: canCountAsWorkTime,
      status: getWorkSessionStatus({
        canCountAsWorkTime,
        hasExpectedSchedule,
        locationStatus: locationResult.locationStatus,
        minutesLate,
      }),
      minutesLate: canCountAsWorkTime ? minutesLate : 0,
      attemptedAt: serverTimestamp(),
      attemptedAtMillis: nowMillis,
      attemptedTimeText: nowTimeText,
      lastSeenAt: serverTimestamp(),
      lastSeenMillis: nowMillis,
      lastRealActivityAt: new Date(nowMillis),
      lastRealActivityMillis: nowMillis,
      idleLimitMinutes: IDLE_LIMIT_MINUTES,
      isIdle: false,
      countingStatus: "notCounted",
      effectiveEndAt: null,
      effectiveEndMillis: null,
      effectiveEndReason: "",
      updatedAt: serverTimestamp(),
    };

    if (!existingData) {
      basePayload.createdAt = serverTimestamp();
    }

    if (canCountAsWorkTime && !existingData?.isCountedAsWorkTime) {
      basePayload.countingStatus = "active";
      basePayload.checkInAt = serverTimestamp();
      basePayload.checkInMillis = nowMillis;
      basePayload.checkInTimeText = nowTimeText;
      basePayload.checkInSource = "loginLocation";
      basePayload.checkOutAt = null;
      basePayload.checkOutMillis = null;
    }

    if (existingData?.isCountedAsWorkTime) {
      basePayload.isCountedAsWorkTime = true;
      basePayload.checkInMillis = existingData.checkInMillis || nowMillis;
      basePayload.checkInTimeText = existingData.checkInTimeText || nowTimeText;
      basePayload.checkInSource = existingData.checkInSource || "loginLocation";
      basePayload.status = existingData.status || basePayload.status;
      basePayload.minutesLate = existingData.minutesLate || 0;

      if (existingIsInactive) {
        basePayload.isIdle = true;
        basePayload.countingStatus = "inactive";
        basePayload.effectiveEndAt = existingData.effectiveEndAt || null;
        basePayload.effectiveEndMillis = existingData.effectiveEndMillis || null;
        basePayload.effectiveEndReason = existingData.effectiveEndReason || "idle";
      } else {
        basePayload.isIdle = false;
        basePayload.countingStatus = "active";
        basePayload.effectiveEndAt = null;
        basePayload.effectiveEndMillis = null;
        basePayload.effectiveEndReason = "";
      }
    }

    await setDoc(sessionRef, basePayload, { merge: true });

    if (basePayload.isCountedAsWorkTime && !existingIsInactive) {
      const sessionActivityMillis = nowMillis;

      lastRealActivityMillisRef.current = sessionActivityMillis;

      setActiveSession({
        id: sessionId,
        checkInMillis: basePayload.checkInMillis || existingData?.checkInMillis || nowMillis,
        lastRealActivityMillis: sessionActivityMillis,
      });
    } else if (existingIsInactive) {
      setActiveSession(null);
    }

    return sessionId;
  }

  async function updateWorkSessionHeartbeat(sessionData) {
    if (!sessionData?.id) return;

    const nowMillis = Date.now();
    const lastRealActivityMillis =
      lastRealActivityMillisRef.current ||
      sessionData.lastRealActivityMillis ||
      nowMillis;

    if (nowMillis - lastRealActivityMillis >= IDLE_LIMIT_MS) {
      const realWorkedMinutes = sessionData.checkInMillis
        ? Math.max(
            0,
            Math.round((lastRealActivityMillis - sessionData.checkInMillis) / 60000)
          )
        : 0;

      await updateDoc(doc(db, "workSessions", sessionData.id), {
        lastSeenAt: serverTimestamp(),
        lastSeenMillis: nowMillis,
        lastRealActivityAt: new Date(lastRealActivityMillis),
        lastRealActivityMillis,
        idleLimitMinutes: IDLE_LIMIT_MINUTES,
        isIdle: true,
        countingStatus: "inactive",
        effectiveEndAt: new Date(lastRealActivityMillis),
        effectiveEndMillis: lastRealActivityMillis,
        effectiveEndReason: "idle",
        idleDetectedAt: serverTimestamp(),
        idleDetectedMillis: nowMillis,
        realWorkedMinutes,
        updatedAt: serverTimestamp(),
      });

      setActiveSession(null);
      return;
    }

    await updateDoc(doc(db, "workSessions", sessionData.id), {
      lastSeenAt: serverTimestamp(),
      lastSeenMillis: nowMillis,
      lastRealActivityAt: new Date(lastRealActivityMillis),
      lastRealActivityMillis,
      idleLimitMinutes: IDLE_LIMIT_MINUTES,
      isIdle: false,
      countingStatus: "active",
      effectiveEndAt: null,
      effectiveEndMillis: null,
      effectiveEndReason: "",
      updatedAt: serverTimestamp(),
    });
  }

  async function closeActiveWorkSession() {
    if (!activeSession?.id) return;

    const nowMillis = Date.now();
    const lastRealActivityMillis =
      lastRealActivityMillisRef.current ||
      activeSession.lastRealActivityMillis ||
      nowMillis;
    const shouldCloseByIdle = nowMillis - lastRealActivityMillis >= IDLE_LIMIT_MS;
    const effectiveEndMillis = shouldCloseByIdle ? lastRealActivityMillis : nowMillis;
    const realWorkedMinutes = activeSession.checkInMillis
      ? Math.max(0, Math.round((effectiveEndMillis - activeSession.checkInMillis) / 60000))
      : 0;

    try {
      const payload = {
        lastSeenAt: serverTimestamp(),
        lastSeenMillis: nowMillis,
        lastRealActivityAt: new Date(lastRealActivityMillis),
        lastRealActivityMillis,
        realWorkedMinutes,
        updatedAt: serverTimestamp(),
      };

      if (shouldCloseByIdle) {
        payload.isIdle = true;
        payload.countingStatus = "inactive";
        payload.effectiveEndAt = new Date(lastRealActivityMillis);
        payload.effectiveEndMillis = lastRealActivityMillis;
        payload.effectiveEndReason = "idle";
        payload.idleDetectedAt = serverTimestamp();
        payload.idleDetectedMillis = nowMillis;
      } else {
        payload.checkOutAt = serverTimestamp();
        payload.checkOutMillis = nowMillis;
        payload.isIdle = false;
        payload.countingStatus = "closed";
        payload.effectiveEndAt = new Date(nowMillis);
        payload.effectiveEndMillis = nowMillis;
        payload.effectiveEndReason = "logout";
      }

      await updateDoc(doc(db, "workSessions", activeSession.id), payload);
    } catch (error) {
      console.error("No se pudo cerrar la jornada activa:", error);
    }
  }

  async function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  async function logout() {
    await closeActiveWorkSession();
    setActiveSession(null);
    return signOut(auth);
  }

  const role = normalizeRole(profile?.role);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        users: directoryUsers,
        loading,
        login,
        logout,
        refreshProfile,

        uid: firebaseUser?.uid || null,
        userEmail: firebaseUser?.email || null,

        isAdmin: role === "admin",
        isCollaborator: role === "collaborator",
        isRequester: role === "requester",

        isActive: profile?.active === true,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

async function getExpectedScheduleForToday(userId, dayKey, dateValue) {
  const adjustmentsSnapshot = await getDocs(
    query(collection(db, "scheduleAdjustments"), where("userId", "==", userId))
  ).catch(() => null);

  const adjustment = adjustmentsSnapshot?.docs
    ?.map((item) => ({ id: item.id, ...item.data() }))
    ?.filter((item) => item.isActive !== false)
    ?.find((item) => isDateInRangeValue(dateValue, item.startDate, item.endDate));

  if (adjustment) {
    const publicStatus = adjustment.publicStatus || adjustment.type;

    if (["permission", "absence", "dayOff"].includes(publicStatus)) {
      return {
        status: publicStatus,
        startTime: "",
        endTime: "",
      };
    }

    if (adjustment.startTime && adjustment.endTime) {
      return {
        status: "adjusted",
        startTime: adjustment.startTime,
        endTime: adjustment.endTime,
      };
    }
  }

  const scheduleSnapshot = await getDoc(doc(db, "workSchedules", `${sanitizeId(userId)}_${dayKey}`)).catch(
    () => null
  );

  if (!scheduleSnapshot?.exists?.()) {
    return {
      status: "noSchedule",
      startTime: "",
      endTime: "",
    };
  }

  const schedule = scheduleSnapshot.data();

  if (schedule.isActive === false || schedule.isRestDay) {
    return {
      status: schedule.isRestDay ? "rest" : "inactive",
      startTime: "",
      endTime: "",
    };
  }

  return {
    status: "scheduled",
    startTime: schedule.startTime || "",
    endTime: schedule.endTime || "",
  };
}

async function getActiveAttendanceLocations() {
  const snapshot = await getDocs(collection(db, "attendanceLocations")).catch(() => null);

  if (!snapshot) return [];

  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((location) => location.isActive !== false);
}

function getCurrentBrowserLocationSafe() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ status: "locationUnavailable" });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          status: "ok",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        resolve({
          status: error.code === 1 ? "locationDenied" : "locationUnavailable",
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  });
}

function getLocationValidationResult({ currentLocation, attendanceLocations }) {
  if (!attendanceLocations.length) {
    return { locationStatus: "noLocationsConfigured" };
  }

  if (!currentLocation || currentLocation.status !== "ok") {
    return { locationStatus: currentLocation?.status || "locationUnavailable" };
  }

  const nearest = attendanceLocations
    .map((location) => {
      const distanceMeters = getDistanceMeters(
        currentLocation.latitude,
        currentLocation.longitude,
        Number(location.latitude),
        Number(location.longitude)
      );

      return {
        ...location,
        distanceMeters,
        allowedRadiusMeters: Number(location.allowedRadiusMeters || 150),
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];

  if (!nearest) {
    return { locationStatus: "outsideLocation" };
  }

  const insideLocation = nearest.distanceMeters <= nearest.allowedRadiusMeters;

  return {
    locationStatus: insideLocation ? "insideLocation" : "outsideLocation",
    locationName: nearest.name || "Sede autorizada",
    distanceMeters: nearest.distanceMeters,
  };
}

function getWorkSessionStatus({
  canCountAsWorkTime,
  hasExpectedSchedule,
  locationStatus,
  minutesLate,
}) {
  if (!hasExpectedSchedule) return "noSchedule";
  if (!canCountAsWorkTime) return locationStatus || "notCounted";
  if (minutesLate > 0) return "late";
  return "onTime";
}

function getTodayKey(date = new Date()) {
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

function getDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getDateTimeMillis(dateValue, timeValue) {
  return new Date(`${dateValue}T${timeValue}:00`).getTime();
}

function getMinutesBetween(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  if (start === null || end === null) return 0;
  if (end >= start) return end - start;
  return 24 * 60 - start + end;
}

function timeToMinutes(value = "") {
  const [hours, minutes] = value.split(":").map(Number);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  return hours * 60 + minutes;
}

function formatTimeFromDate(date) {
  return date.toLocaleTimeString("es-MX", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isDateInRangeValue(targetDate, startDate, endDate) {
  if (!targetDate || !startDate) return false;

  const end = endDate || startDate;

  return targetDate >= startDate && targetDate <= end;
}

function sanitizeId(value = "") {
  return String(value).replaceAll("/", "_");
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((value) => Number.isNaN(Number(value)))) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}
