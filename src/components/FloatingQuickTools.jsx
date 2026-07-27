import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../services/firebase";
import { getPastedImageFiles } from "../utils/clipboardAttachments";
import MessageAudioPlayer from "./MessageAudioPlayer";
import MessageText from "./MessageText";
import DepartmentReadReceipt from "./DepartmentReadReceipt";
import UserAvatar from "./UserAvatar";
import { getMessagePreview, isAudioMessage } from "../utils/messageUtils";
import {
  filterVisibleDepartmentMessages,
  userBelongsToDepartmentId,
} from "../utils/departmentMembership";
import { subscribeToVisibleDepartmentMessages } from "../services/departmentMessagesService";

const MAX_RECENT_CONVERSATIONS = 8;
const BOARD_ATTACHMENT_ACCEPT = [
  "image/*",
  "video/*",
  "audio/*",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
  ".zip",
].join(",");
const NOTE_COLOR_OPTIONS = [
  { value: "yellow", label: "Amarillo", className: "yellow" },
  { value: "blue", label: "Azul", className: "blue" },
  { value: "green", label: "Verde", className: "green" },
  { value: "pink", label: "Rosa", className: "pink" },
  { value: "purple", label: "Morado", className: "purple" },
];

export default function FloatingQuickTools({
  profile,
  isAdmin = false,
  unreadMessagesCount = 0,
  onOpenMessages = () => {},
  onOpenNotes = () => {},
}) {
  const currentUserId = getCurrentUserId(profile);
  const [activeTool, setActiveTool] = useState("");
  const [collaborators, setCollaborators] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [inboxMessages, setInboxMessages] = useState([]);
  const [sentMessages, setSentMessages] = useState([]);
  const [departmentMessages, setDepartmentMessages] = useState([]);
  const [selectedConversationKey, setSelectedConversationKey] = useState("");
  const [newRecipientId, setNewRecipientId] = useState("");
  const [messageText, setMessageText] = useState("");
  const [messageAttachments, setMessageAttachments] = useState([]);
  const [replyTarget, setReplyTarget] = useState(null);
  const [messageSaving, setMessageSaving] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [notePinned, setNotePinned] = useState(false);
  const [noteColor, setNoteColor] = useState("yellow");
  const [noteTab, setNoteTab] = useState("editor");
  const [personalNotes, setPersonalNotes] = useState([]);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteStatus, setNoteStatus] = useState("");
  const [noteError, setNoteError] = useState("");
  const [voiceRecordingType, setVoiceRecordingType] = useState("");
  const [voiceRecordingElapsedMs, setVoiceRecordingElapsedMs] = useState(0);
  const [voiceRecordingPaused, setVoiceRecordingPaused] = useState(false);
  const [voiceRecordingProcessing, setVoiceRecordingProcessing] = useState(false);
  const [voicePauseSupported, setVoicePauseSupported] = useState(false);
  const [voiceWaveLevels, setVoiceWaveLevels] = useState([0.3, 0.55, 0.42, 0.7, 0.36, 0.62, 0.45]);
  const threadRef = useRef(null);
  const fileInputRef = useRef(null);
  const messageAttachmentsRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStreamRef = useRef(null);
  const voiceStopActionRef = useRef("draft");
  const voiceRecordingStartedAtRef = useRef(0);
  const voiceRecordingAccumulatedMsRef = useRef(0);
  const voiceTimerRef = useRef(null);
  const voiceAudioContextRef = useRef(null);
  const voiceAnalyserRef = useRef(null);
  const voiceAnalyserDataRef = useRef(null);
  const voiceWaveFrameRef = useRef(null);
  const voiceWaveLastUpdateRef = useRef(0);

  function stopVoiceStream() {
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    mediaRecorderRef.current = null;
  }

  function clearVoiceTimer() {
    if (voiceTimerRef.current) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }

  function stopVoiceWave() {
    if (voiceWaveFrameRef.current) {
      window.cancelAnimationFrame(voiceWaveFrameRef.current);
      voiceWaveFrameRef.current = null;
    }

    if (voiceAudioContextRef.current) {
      voiceAudioContextRef.current.close().catch(() => {});
      voiceAudioContextRef.current = null;
    }

    voiceAnalyserRef.current = null;
    voiceAnalyserDataRef.current = null;
    voiceWaveLastUpdateRef.current = 0;
    setVoiceWaveLevels([0.18, 0.22, 0.2, 0.24, 0.19, 0.21, 0.18]);
  }

  function startVoiceWave(stream) {
    stopVoiceWave();

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !stream) return;

    try {
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);

      voiceAudioContextRef.current = audioContext;
      voiceAnalyserRef.current = analyser;
      voiceAnalyserDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const draw = (timestamp) => {
        if (!voiceAnalyserRef.current || !voiceAnalyserDataRef.current) return;
        voiceAnalyserRef.current.getByteFrequencyData(voiceAnalyserDataRef.current);

        if (timestamp - voiceWaveLastUpdateRef.current > 80) {
          const data = voiceAnalyserDataRef.current;
          const step = Math.max(1, Math.floor(data.length / 7));
          const levels = Array.from({ length: 7 }, (_, index) => {
            const slice = data.slice(index * step, (index + 1) * step);
            const average = slice.reduce((sum, value) => sum + value, 0) / Math.max(slice.length, 1);
            return Math.min(1, Math.max(0.16, average / 150));
          });

          setVoiceWaveLevels(levels);
          voiceWaveLastUpdateRef.current = timestamp;
        }

        voiceWaveFrameRef.current = window.requestAnimationFrame(draw);
      };

      voiceWaveFrameRef.current = window.requestAnimationFrame(draw);
    } catch (error) {
      console.warn("No se pudo iniciar el analizador de audio rapido:", error);
    }
  }

  function startVoiceTimer() {
    clearVoiceTimer();
    voiceRecordingStartedAtRef.current = Date.now();
    voiceTimerRef.current = window.setInterval(() => {
      setVoiceRecordingElapsedMs(
        voiceRecordingAccumulatedMsRef.current + Date.now() - voiceRecordingStartedAtRef.current
      );
    }, 250);
  }

  function resetVoiceRecorderState() {
    clearVoiceTimer();
    stopVoiceWave();
    voiceRecordingStartedAtRef.current = 0;
    voiceRecordingAccumulatedMsRef.current = 0;
    voiceStopActionRef.current = "draft";
    voiceChunksRef.current = [];
    stopVoiceStream();
    setVoiceRecordingType("");
    setVoiceRecordingElapsedMs(0);
    setVoiceRecordingPaused(false);
    setVoiceRecordingProcessing(false);
    setVoicePauseSupported(false);
  }

  function createVoiceDraftFile(mimeType = "") {
    const extension = getAudioFileExtension(mimeType);
    const blob = new Blob(voiceChunksRef.current, { type: mimeType || "audio/webm" });
    if (!blob.size) return null;

    const file = new File([blob], `audio-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`, {
      type: mimeType || "audio/webm",
    });

    return createDraftAttachment(file, { source: "recordedVoice" });
  }

  useEffect(() => {
    messageAttachmentsRef.current = messageAttachments;
  }, [messageAttachments]);

  useEffect(() => {
    return () => {
      revokeDraftAttachmentPreviews(messageAttachmentsRef.current);
      clearVoiceTimer();
      if (voiceWaveFrameRef.current) {
        window.cancelAnimationFrame(voiceWaveFrameRef.current);
        voiceWaveFrameRef.current = null;
      }
      if (voiceAudioContextRef.current) {
        voiceAudioContextRef.current.close().catch(() => {});
        voiceAudioContextRef.current = null;
      }
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return undefined;

    const notesQuery = query(
      collection(db, "personalNotes"),
      where("userId", "==", currentUserId)
    );

    return onSnapshot(
      notesQuery,
      (snapshot) => {
        const nextNotes = snapshot.docs
          .map((noteDoc) => ({ id: noteDoc.id, ...noteDoc.data() }))
          .sort(sortPersonalNotes)
          .slice(0, 6);

        setPersonalNotes(nextNotes);
      },
      () => setPersonalNotes([])
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    return onSnapshot(
      query(collection(db, "users"), where("active", "==", true)),
      (snapshot) => {
        const nextCollaborators = snapshot.docs
          .map((userDoc) => ({ id: userDoc.id, ...userDoc.data() }))
          .filter((user) => user.id !== currentUserId)
          .filter((user) => user.active !== false && user.deleted !== true)
          .filter((user) => user.email || user.name)
          .sort((a, b) =>
            String(a.name || a.email || "").localeCompare(
              String(b.name || b.email || ""),
              "es"
            )
          );

        setCollaborators(nextCollaborators);
      },
      () => setCollaborators([])
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    return onSnapshot(
      collection(db, "departments"),
      (snapshot) => {
        const nextDepartments = snapshot.docs
          .map((departmentDoc) => ({ id: departmentDoc.id, ...departmentDoc.data() }))
          .filter((department) => department.active !== false && department.deleted !== true)
          .filter((department) => department.name || department.title)
          .sort((a, b) =>
            String(a.name || a.title || "").localeCompare(
              String(b.name || b.title || ""),
              "es"
            )
          );

        setDepartments(nextDepartments);
      },
      () => setDepartments([])
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    return onSnapshot(
      query(collection(db, "internalMessages"), where("toUserId", "==", currentUserId)),
      (snapshot) => {
        setInboxMessages(
          snapshot.docs
            .map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() }))
            .sort(sortByCreatedAtDesc)
        );
      },
      () => setInboxMessages([])
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    return onSnapshot(
      query(collection(db, "internalMessages"), where("fromUserId", "==", currentUserId)),
      (snapshot) => {
        setSentMessages(
          snapshot.docs
            .map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() }))
            .sort(sortByCreatedAtDesc)
        );
      },
      () => setSentMessages([])
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    return subscribeToVisibleDepartmentMessages({
      profile,
      isAdmin,
      onMessages: (messages) => {
        setDepartmentMessages(messages.sort(sortByCreatedAtDesc));
      },
      onError: () => setDepartmentMessages([]),
    });
  }, [currentUserId, isAdmin, profile]);

  const departmentOptions = useMemo(
    () =>
      buildDepartmentChatOptions({
        departments,
        collaborators,
        profile,
        currentUserId,
        isAdmin,
      }),
    [departments, collaborators, profile, currentUserId, isAdmin]
  );

  const directConversations = useMemo(
    () =>
      buildInternalConversations(
        [...inboxMessages, ...sentMessages].sort(sortByCreatedAtDesc),
        collaborators,
        currentUserId
      ),
    [inboxMessages, sentMessages, collaborators, currentUserId]
  );

  const visibleDepartmentMessages = useMemo(
    () => filterVisibleDepartmentMessages(departmentMessages, profile, isAdmin),
    [departmentMessages, profile, isAdmin]
  );

  const departmentConversations = useMemo(
    () =>
      buildDepartmentConversations(
        visibleDepartmentMessages,
        departmentOptions,
        currentUserId
      ).filter((conversation) => conversation.messages.length > 0),
    [visibleDepartmentMessages, departmentOptions, currentUserId]
  );
  const messageProfiles = useMemo(
    () => [{ ...profile, id: currentUserId }, ...collaborators],
    [profile, currentUserId, collaborators]
  );

  const recentConversations = useMemo(
    () =>
      [
        ...directConversations.map((conversation) => ({
          key: `direct:${conversation.participantId}`,
          type: "direct",
          participantId: conversation.participantId,
          title: conversation.participantName,
          subtitle: conversation.participantEmail || "Chat individual",
          unreadCount: conversation.unreadCount,
          lastMessage: conversation.lastMessage,
          conversation,
        })),
        ...departmentConversations.map((conversation) => ({
          key: `department:${conversation.departmentId}`,
          type: "department",
          title: conversation.departmentName,
          subtitle: "Chat por departamento",
          unreadCount: conversation.unreadCount,
          lastMessage: conversation.lastMessage,
          conversation,
        })),
      ]
        .sort((a, b) => {
          const unreadDiff = Number(b.unreadCount > 0) - Number(a.unreadCount > 0);
          if (unreadDiff !== 0) return unreadDiff;
          return (
            getMillisFromFirestoreDate(b.lastMessage?.createdAt) -
            getMillisFromFirestoreDate(a.lastMessage?.createdAt)
          );
        })
        .slice(0, MAX_RECENT_CONVERSATIONS),
    [directConversations, departmentConversations]
  );

  const selectedRecentConversation = recentConversations.find(
    (conversation) => conversation.key === selectedConversationKey
  );

  useEffect(() => {
    if (!selectedConversationKey || selectedRecentConversation) return;

    const timeoutId = window.setTimeout(() => {
      setSelectedConversationKey("");
      setReplyTarget(null);
      setMessageText("");
      setMessageAttachments([]);
      setMessageError("");
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [selectedConversationKey, selectedRecentConversation]);
  const selectedDirectConversation =
    selectedRecentConversation?.type === "direct"
      ? selectedRecentConversation.conversation
      : null;
  const selectedDepartmentConversation =
    selectedRecentConversation?.type === "department"
      ? selectedRecentConversation.conversation
      : null;
  const selectedNewRecipient = collaborators.find((user) => user.id === newRecipientId) || null;
  const activeMessages = useMemo(
    () =>
      (
        selectedDirectConversation?.messages ||
        selectedDepartmentConversation?.messages ||
        []
      )
        .slice()
        .sort(sortByCreatedAtAsc),
    [selectedDirectConversation, selectedDepartmentConversation]
  );
  const canSendMessage = Boolean(
    selectedDirectConversation ||
      selectedDepartmentConversation ||
      selectedNewRecipient
  );
  const activeLastMessage = activeMessages[activeMessages.length - 1] || null;
  const activeLastMessageKey = activeLastMessage
    ? `${activeLastMessage.id || ""}:${getMillisFromFirestoreDate(activeLastMessage.createdAt)}:${getMillisFromFirestoreDate(activeLastMessage.updatedAt)}`
    : "";
  const activeConversationType = selectedDepartmentConversation
    ? "department"
    : selectedDirectConversation
      ? "direct"
      : "";
  const visibleReplyTarget = replyTarget?.type === activeConversationType ? replyTarget : null;
  const quickMessageHasText = Boolean(messageText.trim());
  const quickMessageCanSend = quickMessageHasText || messageAttachments.length > 0;
  const quickComposerRecording = Boolean(voiceRecordingType);
  const quickComposerUsesVoiceButton = quickComposerRecording || !quickMessageCanSend;
  const voiceRecordingLabel = formatVoiceRecordingDuration(voiceRecordingElapsedMs);

  useEffect(() => {
    if (activeTool !== "messages" || activeMessages.length === 0) return;

    activeMessages.forEach((message) => {
      if (selectedDirectConversation) {
        markDirectMessageAsRead(message, currentUserId);
      } else if (selectedDepartmentConversation) {
        markDepartmentMessageAsRead(message, currentUserId);
      }
    });
  }, [
    activeTool,
    selectedConversationKey,
    activeMessages,
    selectedDirectConversation,
    selectedDepartmentConversation,
    currentUserId,
  ]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape" || activeTool !== "messages" || !selectedConversationKey) return;
      if (replyTarget || voiceRecordingType) return;
      setSelectedConversationKey("");
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [activeTool, selectedConversationKey, replyTarget, voiceRecordingType]);

  function scrollThreadToBottom(behavior = "auto") {
    if (typeof window === "undefined") return;

    const scrollNow = () => {
      const thread = threadRef.current;
      if (!thread) return;

      thread.scrollTo({
        top: thread.scrollHeight,
        behavior,
      });
    };

    window.requestAnimationFrame(() => {
      scrollNow();
      window.setTimeout(scrollNow, 90);
    });
  }

  useLayoutEffect(() => {
    if (activeTool !== "messages") return;
    scrollThreadToBottom("auto");
  }, [activeTool, activeMessages.length, activeLastMessageKey, selectedConversationKey]);

  function toggleTool(toolName) {
    setActiveTool((current) => (current === toolName ? "" : toolName));
    setMessageError("");
    setNoteError("");
    setNoteStatus("");
  }

  function selectConversation(conversationKey) {
    setSelectedConversationKey(conversationKey);
    setNewRecipientId("");
    setReplyTarget(null);
    setMessageError("");
  }

  function handleReplyToMessage(message) {
    const type = selectedDepartmentConversation ? "department" : "direct";

    setReplyTarget({
      type,
      messageId: message.id,
      fromUserId: message.fromUserId || "",
      fromUserName: message.fromUserId === currentUserId ? "Tu" : message.fromUserName || "Usuario",
      message: message.message || "Archivo adjunto",
      createdAt: message.createdAt || null,
    });
  }

  async function handleDeleteMessage(message) {
    if (!isAdmin || !message?.id) return;

    const confirmed = window.confirm(
      "¿Eliminar este mensaje para todos? Esta acción no se puede deshacer."
    );
    if (!confirmed) return;

    setMessageError("");

    try {
      const collectionName = selectedDepartmentConversation
        ? "departmentMessages"
        : "internalMessages";
      await deleteDoc(doc(db, collectionName, message.id));
      if (replyTarget?.messageId === message.id) {
        setReplyTarget(null);
      }
    } catch (error) {
      console.error("No se pudo eliminar el mensaje rápido:", error);
      setMessageError("No se pudo eliminar el mensaje.");
    }
  }

  function handleMessageFileSelection(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    const validation = validateBoardFiles(files, messageAttachments.length);
    if (!validation.valid) {
      setMessageError(validation.message);
      return;
    }

    setMessageAttachments((current) => [
      ...current,
      ...files.map(createDraftAttachment),
    ]);
    setMessageError("");
  }

  function handleMessagePaste(event) {
    const files = getPastedImageFiles(event);
    if (files.length === 0) return;
    event.preventDefault();
    const validation = validateBoardFiles(files, messageAttachments.length);
    if (!validation.valid) {
      setMessageError(validation.message);
      return;
    }
    setMessageAttachments((current) => [...current, ...files.map(createDraftAttachment)].slice(0, 6));
    setMessageError("");
  }

  function handleRemoveMessageAttachment(attachmentId) {
    setMessageAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== attachmentId);
      const removed = current.find((attachment) => attachment.id === attachmentId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return next;
    });
  }

  function handleToggleVoicePause() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || voiceRecordingProcessing) return;

    if (recorder.state === "recording") {
      if (typeof recorder.pause !== "function") {
        setMessageError("Este navegador no permite pausar la grabacion.");
        return;
      }

      recorder.pause();
      voiceRecordingAccumulatedMsRef.current += Date.now() - voiceRecordingStartedAtRef.current;
      setVoiceRecordingElapsedMs(voiceRecordingAccumulatedMsRef.current);
      clearVoiceTimer();
      stopVoiceWave();
      setVoiceRecordingPaused(true);
      return;
    }

    if (recorder.state === "paused" && typeof recorder.resume === "function") {
      recorder.resume();
      setVoiceRecordingPaused(false);
      startVoiceTimer();
      startVoiceWave(voiceStreamRef.current);
    }
  }

  function finishVoiceRecording(action = "draft") {
    if (voiceRecordingProcessing) return;

    const recorder = mediaRecorderRef.current;
    voiceStopActionRef.current = action;
    if (action === "send") {
      setVoiceRecordingProcessing(true);
    }

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    resetVoiceRecorderState();
  }

  async function sendVoiceRecording(draftAttachment) {
    if (!draftAttachment) {
      setMessageError("No se pudo preparar el audio.");
      return;
    }

    setMessageSaving(true);
    setMessageError("");

    try {
      if (selectedDepartmentConversation) {
        await sendDepartmentMessage({
          conversation: selectedDepartmentConversation,
          collaborators,
          profile,
          currentUserId,
          message: "Mensaje de audio",
          attachments: [draftAttachment],
          replyTarget,
        });
      } else {
        const recipient =
          selectedNewRecipient ||
          collaborators.find((user) => user.id === selectedDirectConversation?.participantId) ||
          {
            id: selectedDirectConversation?.participantId,
            name: selectedDirectConversation?.participantName,
            email: selectedDirectConversation?.participantEmail,
          };

        await sendDirectMessage({
          recipient,
          profile,
          currentUserId,
          message: "Mensaje de audio",
          attachments: [draftAttachment],
          replyTarget,
        });

        if (recipient?.id) {
          setSelectedConversationKey(`direct:${recipient.id}`);
          setNewRecipientId("");
        }
      }

      setMessageText("");
      setReplyTarget(null);
      scrollThreadToBottom("auto");
    } catch (error) {
      console.error("No se pudo enviar el audio rapido:", error);
      setMessageError("No se pudo enviar el audio.");
    } finally {
      setMessageSaving(false);
    }
  }

  async function handleStartVoiceRecording() {
    if (voiceRecordingType) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessageError("Este navegador no permite grabar audio desde aqui.");
      return;
    }

    if (!window.isSecureContext) {
      setMessageError("Grabar audio requiere una conexion segura (HTTPS).");
      return;
    }

    if (messageAttachments.length >= 6) {
      setMessageError("Solo puedes adjuntar hasta 6 archivos por mensaje.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = pickSupportedAudioMimeType();
      const recorder = new MediaRecorder(stream, preferredMimeType ? { mimeType: preferredMimeType } : undefined);
      voiceChunksRef.current = [];
      voiceStopActionRef.current = "draft";
      voiceStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setVoiceRecordingElapsedMs(0);
      setVoiceRecordingPaused(false);
      setVoiceRecordingProcessing(false);
      setVoicePauseSupported(typeof recorder.pause === "function" && typeof recorder.resume === "function");

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        clearVoiceTimer();
        const action = voiceStopActionRef.current;

        if (action === "cancel") {
          resetVoiceRecorderState();
          return;
        }

        const draft = createVoiceDraftFile(recorder.mimeType || preferredMimeType || "audio/webm");

        if (action === "send") {
          await sendVoiceRecording(draft);
          resetVoiceRecorderState();
          return;
        }

        if (draft) {
          setMessageAttachments((current) => [...current, draft].slice(0, 6));
        }

        resetVoiceRecorderState();
      };

      recorder.start();
      setVoiceRecordingType("message");
      startVoiceTimer();
      startVoiceWave(stream);
      setMessageError("");
    } catch (error) {
      console.error("No se pudo iniciar la grabacion de audio:", error);
      setMessageError(getVoiceRecordingErrorMessage(error));
      stopVoiceStream();
      setVoiceRecordingType("");
    }
  }

  function handleStopVoiceRecording() {
    finishVoiceRecording("draft");
  }

  async function handleMessageSubmit(event) {
    event.preventDefault();
    setMessageError("");

    const cleanMessage = messageText.trim();
    if (!cleanMessage && messageAttachments.length === 0) {
      setMessageError("Escribe un mensaje o adjunta un archivo.");
      return;
    }

    if (!canSendMessage) {
      setMessageError("Selecciona una conversacion.");
      return;
    }

    setMessageSaving(true);

    try {
      if (selectedDepartmentConversation) {
        await sendDepartmentMessage({
          conversation: selectedDepartmentConversation,
          collaborators,
          profile,
          currentUserId,
          message: cleanMessage || "Archivo adjunto",
          attachments: messageAttachments,
          replyTarget,
        });
      } else {
        const recipient =
          selectedNewRecipient ||
          collaborators.find((user) => user.id === selectedDirectConversation?.participantId) ||
          {
            id: selectedDirectConversation?.participantId,
            name: selectedDirectConversation?.participantName,
            email: selectedDirectConversation?.participantEmail,
          };

        await sendDirectMessage({
          recipient,
          profile,
          currentUserId,
          message: cleanMessage || "Archivo adjunto",
          attachments: messageAttachments,
          replyTarget,
        });

        if (recipient?.id) {
          setSelectedConversationKey(`direct:${recipient.id}`);
          setNewRecipientId("");
        }
      }

      setMessageText("");
      setReplyTarget(null);
      revokeDraftAttachmentPreviews(messageAttachments);
      setMessageAttachments([]);
      scrollThreadToBottom("auto");
    } catch (error) {
      console.error("No se pudo enviar el mensaje rapido:", error);
      setMessageError("No se pudo enviar el mensaje.");
    } finally {
      setMessageSaving(false);
    }
  }

  async function handleNoteSubmit(event) {
    event.preventDefault();
    setNoteError("");
    setNoteStatus("");

    const cleanTitle = noteTitle.trim();
    const cleanContent = noteContent.trim();

    if (!cleanTitle && !cleanContent) {
      setNoteError("Escribe una nota.");
      return;
    }

    setNoteSaving(true);

    try {
      const noteId = doc(collection(db, "personalNotes")).id;

      await setDoc(doc(db, "personalNotes", noteId), {
        userId: currentUserId,
        title: cleanTitle || "Nota personal",
        content: cleanContent,
        color: normalizeNoteColor(noteColor),
        attachments: [],
        pinned: notePinned,
        completed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNoteTitle("");
      setNoteContent("");
      setNotePinned(false);
      setNoteColor("yellow");
      setNoteStatus("Nota guardada.");
      setNoteTab("recent");
    } catch (error) {
      console.error("No se pudo guardar la nota rapida:", error);
      setNoteError("No se pudo guardar la nota.");
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleDeleteNote(noteId) {
    if (!noteId) return;

    setNoteError("");
    setNoteStatus("");

    try {
      await deleteDoc(doc(db, "personalNotes", noteId));
      setNoteStatus("Nota eliminada.");
    } catch (error) {
      console.error("No se pudo eliminar la nota rapida:", error);
      setNoteError("No se pudo eliminar la nota.");
    }
  }

  if (!currentUserId) return null;

  return (
    <div className={`quick-tools-root ${activeTool ? "panel-open" : ""}`}>
      {activeTool === "messages" && (
        <section className="quick-tools-panel quick-tools-messages-panel" aria-label="Mensajes rapidos">
          <header className="quick-tools-panel-header">
            <div className="quick-tools-title">
              <span className="quick-tools-title-icon"><QuickToolIcon name="messages" /></span>
              <div>
              <strong>Mensajes</strong>
              <span>{unreadMessagesCount > 0 ? `${formatBadgeCount(unreadMessagesCount)} no leidos` : "Sin pendientes"}</span>
              </div>
            </div>

            <div className="quick-tools-header-actions">
              <button
                type="button"
                onClick={() => {
                  setActiveTool("");
                  onOpenMessages();
                }}
              >
                Ver todos los mensajes
              </button>
              <button type="button" aria-label="Cerrar mensajes" onClick={() => setActiveTool("")}>
                <QuickToolIcon name="close" />
              </button>
            </div>
          </header>

          <div className="quick-tools-chat-body">
            <div className="quick-tools-conversation-list" aria-label="Conversaciones recientes">
              <label className="quick-tools-new-recipient">
                <span>Nuevo mensaje</span>
                <select
                  value={newRecipientId}
                  onChange={(event) => {
                    setNewRecipientId(event.target.value);
                    setSelectedConversationKey("");
                    setReplyTarget(null);
                    setMessageError("");
                  }}
                >
                  <option value="">Elegir colaborador</option>
                  {collaborators.map((collaborator) => (
                    <option key={collaborator.id} value={collaborator.id}>
                      {collaborator.name || collaborator.email}
                    </option>
                  ))}
                </select>
              </label>

              {recentConversations.length === 0 ? (
                <p className="quick-tools-empty">Sin conversaciones recientes.</p>
              ) : (
                recentConversations.map((conversation) => (
                  <button
                    key={conversation.key}
                    type="button"
                    className={selectedConversationKey === conversation.key ? "active" : ""}
                    onClick={() => selectConversation(conversation.key)}
                  >
                    <span className="quick-tools-conversation-avatar">
                      {conversation.type === "department" ? (
                        <QuickToolIcon name="team" />
                      ) : (
                        <UserAvatar
                          userId={conversation.participantId}
                          name={conversation.title}
                        />
                      )}
                    </span>
                    <span>
                      <strong>{conversation.title}</strong>
                      <small>{truncateText(conversation.lastMessage ? getMessagePreview(conversation.lastMessage, getAttachmentType) : conversation.subtitle, 62)}</small>
                    </span>
                    {conversation.unreadCount > 0 && (
                      <em>{formatBadgeCount(conversation.unreadCount)}</em>
                    )}
                  </button>
                ))
              )}
            </div>

            <div className="quick-tools-thread">
              <div className="quick-tools-active-chat">
                <strong>
                  {selectedRecentConversation?.title || selectedNewRecipient?.name || selectedNewRecipient?.email || "Sin conversacion activa"}
                </strong>
                <span>
                  {selectedRecentConversation?.subtitle || selectedNewRecipient?.email || "Elige un chat para escribir"}
                </span>
              </div>

              <div ref={threadRef} className="quick-tools-thread-messages">
                {!selectedRecentConversation && !selectedNewRecipient ? (
                  <p className="quick-tools-empty">Abre una conversacion o elige un colaborador.</p>
                ) : activeMessages.length === 0 ? (
                  <p className="quick-tools-empty">Sin mensajes todavia.</p>
                ) : (
                  activeMessages.map((message) => {
                    const outgoing = message.fromUserId === currentUserId;
                    return (
                      <article key={message.id} className={outgoing ? "mine" : ""}>
                        <small>{outgoing ? "Tu" : message.fromUserName || "Usuario"}</small>
                        {message.replyToMessageId && (
                          <div className="quick-tools-reply-reference">
                            <span>{message.replyToFromUserName || "Mensaje citado"}</span>
                            <p><MessageText text={message.replyToMessage || "Mensaje citado"} /></p>
                          </div>
                        )}
                        {!isAudioOnlyMessage(message) && (
                          <p><MessageText text={message.message} /></p>
                        )}
                        <QuickAttachmentGallery attachments={message.attachments} />
                        {outgoing && (
                          <div className="quick-tools-message-status">
                            {selectedDepartmentConversation ? (
                              <>
                                Enviado · <DepartmentReadReceipt message={message} profiles={messageProfiles} />
                              </>
                            ) : message.read ? "Leido" : "Enviado"}
                          </div>
                        )}
                        <button
                          type="button"
                          className="quick-tools-reply-button"
                          onClick={() => handleReplyToMessage(message)}
                        >
                          Responder
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            className="quick-tools-reply-button"
                            onClick={() => handleDeleteMessage(message)}
                          >
                            Eliminar
                          </button>
                        )}
                      </article>
                    );
                  })
                )}
              </div>

              <form className="quick-tools-message-form" onSubmit={handleMessageSubmit}>
                {visibleReplyTarget && (
                  <div className="quick-tools-reply-preview">
                    <div>
                      <span>Respondiendo a {visibleReplyTarget.fromUserName}</span>
                      <p>{visibleReplyTarget.message}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyTarget(null)}
                      aria-label="Cancelar respuesta"
                    >
                      x
                    </button>
                  </div>
                )}
                {quickComposerRecording ? (
                  <div className="quick-tools-voice-recorder-bar" role="status" aria-live="polite">
                    <button
                      type="button"
                      className="quick-tools-recorder-action danger"
                      onClick={() => finishVoiceRecording("cancel")}
                      disabled={voiceRecordingProcessing}
                      aria-label="Cancelar audio"
                      title="Cancelar audio"
                    >
                      <QuickToolIcon name="trash" />
                    </button>
                    <div className="quick-tools-recorder-status">
                      <span className={`quick-tools-recorder-dot ${voiceRecordingPaused ? "paused" : ""}`} />
                      <strong>{voiceRecordingPaused ? "Pausado" : "Grabando"}</strong>
                      <small>{voiceRecordingLabel}</small>
                      <div className={`quick-tools-recorder-wave ${voiceRecordingPaused ? "paused" : ""}`} aria-hidden="true">
                        {voiceWaveLevels.map((level, index) => (
                          <span key={index} style={{ "--wave-level": level }} />
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="quick-tools-recorder-action"
                      onClick={handleToggleVoicePause}
                      disabled={voiceRecordingProcessing || !voicePauseSupported}
                      aria-label={voiceRecordingPaused ? "Continuar grabando" : "Pausar grabacion"}
                      title={voicePauseSupported ? (voiceRecordingPaused ? "Continuar grabando" : "Pausar grabacion") : "Pausa no disponible"}
                    >
                      <QuickToolIcon name={voiceRecordingPaused ? "mic" : "pause"} />
                    </button>
                    <button
                      type="button"
                      className="quick-tools-recorder-action send"
                      onClick={() => finishVoiceRecording("send")}
                      disabled={voiceRecordingProcessing}
                      aria-label="Enviar audio"
                      title="Enviar audio"
                    >
                      <QuickToolIcon name={voiceRecordingProcessing ? "stop" : "send"} />
                    </button>
                  </div>
                ) : (
                  <>
                <textarea
                  spellCheck={true}
                  lang="es-MX"
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  onPaste={handleMessagePaste}
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (!messageSaving) handleMessageSubmit(event);
                    }
                  }}
                  placeholder="Escribe un mensaje..."
                  maxLength={1200}
                  disabled={messageSaving}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={BOARD_ATTACHMENT_ACCEPT}
                  className="quick-tools-hidden-input"
                  onChange={handleMessageFileSelection}
                />
                <QuickAttachmentDraftList
                  items={messageAttachments}
                  onRemove={handleRemoveMessageAttachment}
                />
                <div className="quick-tools-composer-actions">
                  <button
                    type="button"
                    className="quick-tools-icon-button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Adjuntar archivo"
                    aria-label="Adjuntar archivo"
                  >
                    <QuickToolIcon name="paperclip" />
                  </button>
                  <button
                    type={quickComposerUsesVoiceButton ? "button" : "submit"}
                    className={`quick-tools-send-button ${quickComposerUsesVoiceButton ? "voice-mode" : ""} ${quickComposerRecording ? "recording" : ""}`}
                    onClick={
                      quickComposerUsesVoiceButton
                        ? (quickComposerRecording ? handleStopVoiceRecording : handleStartVoiceRecording)
                        : undefined
                    }
                    disabled={messageSaving || !canSendMessage}
                    title={
                      messageSaving
                        ? "Enviando..."
                        : quickComposerUsesVoiceButton
                          ? quickComposerRecording
                            ? "Detener audio"
                            : "Grabar audio"
                          : "Enviar"
                    }
                    aria-label={
                      messageSaving
                        ? "Enviando mensaje"
                        : quickComposerUsesVoiceButton
                          ? quickComposerRecording
                            ? "Detener audio"
                            : "Grabar audio"
                          : "Enviar mensaje"
                    }
                  >
                    <QuickToolIcon name={quickComposerUsesVoiceButton ? (quickComposerRecording ? "stop" : "mic") : "send"} />
                    <span>
                      {messageSaving
                        ? "Enviando..."
                        : quickComposerUsesVoiceButton
                          ? quickComposerRecording
                            ? "Detener"
                            : "Audio"
                          : "Enviar"}
                    </span>
                  </button>
                </div>
                  </>
                )}
                {messageError && <span className="quick-tools-error">{messageError}</span>}
              </form>
            </div>
          </div>
        </section>
      )}

      {activeTool === "notes" && (
        <section className="quick-tools-panel quick-tools-notes-panel" aria-label="Nota rapida">
          <header className="quick-tools-panel-header">
            <div className="quick-tools-title">
              <span className="quick-tools-title-icon note"><QuickToolIcon name="notes" /></span>
              <div>
              <strong>Notas</strong>
              <span>Nota rapida y recientes</span>
              </div>
            </div>

            <div className="quick-tools-header-actions">
              <button
                type="button"
                onClick={() => {
                  setActiveTool("");
                  onOpenNotes();
                }}
              >
                Ver todas
              </button>
              <button type="button" aria-label="Cerrar notas" onClick={() => setActiveTool("")}>
                <QuickToolIcon name="close" />
              </button>
            </div>
          </header>

          <div className="quick-tools-note-tabs" role="tablist" aria-label="Notas rapidas">
            <button
              type="button"
              className={noteTab === "editor" ? "active" : ""}
              onClick={() => setNoteTab("editor")}
            >
              Editor
            </button>
            <button
              type="button"
              className={noteTab === "recent" ? "active" : ""}
              onClick={() => setNoteTab("recent")}
            >
              Recientes
            </button>
          </div>

          {noteTab === "editor" ? (
            <form className="quick-tools-note-form" onSubmit={handleNoteSubmit}>
              <label>
                <span>Titulo</span>
                <input
                  value={noteTitle}
                  onChange={(event) => setNoteTitle(event.target.value)}
                  placeholder="Ej. Pendiente"
                  maxLength={80}
                  disabled={noteSaving}
                />
              </label>

              <label>
                <span>Nota</span>
                <textarea
                  value={noteContent}
                  onChange={(event) => setNoteContent(event.target.value)}
                  placeholder="Escribe una nota rapida..."
                  maxLength={700}
                  disabled={noteSaving}
                />
              </label>

              <div className="quick-tools-note-options">
                <button
                  type="button"
                  className={notePinned ? "active" : ""}
                  onClick={() => setNotePinned((current) => !current)}
                >
                  <QuickToolIcon name="pin" />
                  <span>Fijar nota</span>
                </button>

                <div className="quick-tools-color-picker" aria-label="Color de nota">
                  {NOTE_COLOR_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`${option.className} ${noteColor === option.value ? "active" : ""}`}
                      onClick={() => setNoteColor(option.value)}
                      title={option.label}
                      aria-label={`Color ${option.label}`}
                    />
                  ))}
                </div>
              </div>

              {noteError && <span className="quick-tools-error">{noteError}</span>}
              {noteStatus && <span className="quick-tools-success">{noteStatus}</span>}

              <div className="quick-tools-note-actions">
                <button
                  type="button"
                  className="quick-tools-note-delete"
                  onClick={() => {
                    setNoteTitle("");
                    setNoteContent("");
                    setNotePinned(false);
                    setNoteColor("yellow");
                  }}
                >
                  Limpiar
                </button>

                <button type="submit" className="quick-tools-note-save" disabled={noteSaving}>
                  <QuickToolIcon name="save" />
                  <span>{noteSaving ? "Guardando..." : "Guardar nota"}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="quick-tools-recent-notes">
              {personalNotes.length === 0 ? (
                <p className="quick-tools-empty">Sin notas recientes.</p>
              ) : (
                personalNotes.map((note) => (
                  <article
                    key={note.id}
                    className={`quick-tools-recent-note color-${normalizeNoteColor(note.color)}`}
                  >
                    <div>
                      <strong>{note.title || "Nota personal"}</strong>
                      <p>{truncateText(note.content || "Sin contenido", 110)}</p>
                    </div>
                    <span>{note.pinned ? "Fijada" : "Nota"}</span>
                  <button
                    type="button"
                    onClick={() => handleDeleteNote(note.id)}
                  >
                    Eliminar
                  </button>
                  </article>
                ))
              )}
            </div>
          )}
        </section>
      )}

      <div className="quick-tools-bubbles quick-tools-pills" aria-label="Accesos rapidos">
        <button
          type="button"
          className={activeTool === "messages" ? "active" : ""}
          aria-label="Abrir mensajes"
          onClick={() => toggleTool("messages")}
        >
          <span className="quick-tools-pill-icon"><QuickToolIcon name="messages" /></span>
          {unreadMessagesCount > 0 && <em>{formatBadgeCount(unreadMessagesCount)}</em>}
        </button>

        <button
          type="button"
          className={activeTool === "notes" ? "active" : ""}
          aria-label="Abrir notas rapidas"
          onClick={() => toggleTool("notes")}
        >
          <span className="quick-tools-pill-icon note"><QuickToolIcon name="notes" /></span>
        </button>
      </div>
    </div>
  );
}

function QuickToolIcon({ name }) {
  const paths = {
    messages: (
      <>
        <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H11l-4.5 3v-3A3.5 3.5 0 0 1 3 10.5v-4Z" />
        <path d="M8 7h8M8 10h5" />
      </>
    ),
    notes: (
      <>
        <path d="M7 3h7l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
        <path d="M14 3v5h5M8 12h8M8 16h5" />
      </>
    ),
    team: (
      <>
        <path d="M16 11a3 3 0 1 0-2.8-4M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M2 20a6 6 0 0 1 12 0M14 14a5 5 0 0 1 6 5" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6 6 18" />,
    paperclip: <path d="M21 12.5 12 21a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 1 1-2.8-2.8l9.2-9.2" />,
    mic: (
      <>
        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
        <path d="M19 11a7 7 0 0 1-14 0M12 18v3M8 21h8" />
      </>
    ),
    stop: <path d="M7 7h10v10H7z" />,
    pause: <path d="M8 5h3v14H8zM13 5h3v14h-3z" />,
    trash: (
      <>
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13" />
        <path d="M9 7V4h6v3" />
      </>
    ),
    send: <path d="M4 4l17 8-17 8 3-8-3-8Zm3 8h14" />,
    pin: (
      <>
        <path d="M14 3l7 7-4 1-4.5 4.5.5 4.5-2 2-3.5-6.5L1 12l2-2 4.5.5L12 6l2-3Z" />
      </>
    ),
    save: (
      <>
        <path d="M5 3h12l2 2v16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
        <path d="M7 3v6h9M7 17h10" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[name] || paths.messages}
      </g>
    </svg>
  );
}

function QuickAttachmentDraftList({ items, onRemove }) {
  if (!items.length) return null;

  return (
    <div className="quick-tools-attachment-list">
      {items.map((attachment) => (
        <div key={attachment.id} className="quick-tools-attachment-chip">
          <span>{getAttachmentTypeLabel(getAttachmentType(attachment.contentType, attachment.name))}</span>
          <strong>{attachment.name || "Archivo"}</strong>
          <small>{formatFileSize(attachment.size)}</small>
          <button type="button" onClick={() => onRemove(attachment.id)}>Quitar</button>
        </div>
      ))}
    </div>
  );
}

function QuickAttachmentGallery({ attachments }) {
  const normalized = normalizeStoredAttachments(attachments);
  if (!normalized.length) return null;

  return (
    <div className="quick-tools-attachment-gallery">
      {normalized.map((attachment) => {
        const type = getAttachmentType(attachment.contentType, attachment.name);
        if (type === "audio") {
          return (
            <MessageAudioPlayer
              key={attachment.path || attachment.url}
              attachment={attachment}
            />
          );
        }

        if (type === "image") {
          return (
            <a key={attachment.path || attachment.url} href={attachment.url} target="_blank" rel="noreferrer">
              <img src={attachment.url} alt={attachment.name || "Adjunto"} />
            </a>
          );
        }

        return (
          <a key={attachment.path || attachment.url} href={attachment.url} target="_blank" rel="noreferrer">
            {attachment.name || "Archivo"}
          </a>
        );
      })}
    </div>
  );
}

async function sendDirectMessage({ recipient, profile, currentUserId, message, attachments, replyTarget }) {
  if (!recipient?.id || !currentUserId) {
    throw new Error("missing-recipient");
  }

  const messageId = doc(collection(db, "internalMessages")).id;
  const recipientName = recipient.name || recipient.email || "Usuario";
  const storedAttachments = await uploadBoardAttachments(attachments, {
    folder: `dashboard/internalMessages/${currentUserId}/${recipient.id}/${messageId}`,
    ownerUid: currentUserId,
  });

  await setDoc(doc(db, "internalMessages", messageId), {
    fromUserId: currentUserId,
    fromUserName: profile?.name || "Usuario",
    fromUserEmail: profile?.email || "",
    toUserId: recipient.id,
    toUserName: recipientName,
    toUserEmail: recipient.email || "",
    subject: `Conversacion con ${recipientName}`.slice(0, 120),
    message,
    attachments: storedAttachments,
    replyToMessageId: replyTarget?.type === "direct" ? replyTarget.messageId : "",
    replyToFromUserId: replyTarget?.type === "direct" ? replyTarget.fromUserId : "",
    replyToFromUserName: replyTarget?.type === "direct" ? replyTarget.fromUserName : "",
    replyToMessage: replyTarget?.type === "direct" ? replyTarget.message.slice(0, 240) : "",
    read: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function sendDepartmentMessage({
  conversation,
  collaborators,
  profile,
  currentUserId,
  message,
  attachments,
  replyTarget,
}) {
  if (!conversation?.departmentId || !currentUserId) {
    throw new Error("missing-department");
  }

  const memberIds = getDepartmentMemberIds(conversation, collaborators, profile, currentUserId);
  if (!memberIds.includes(currentUserId)) {
    memberIds.push(currentUserId);
  }

  const messageId = doc(collection(db, "departmentMessages")).id;
  const storedAttachments = await uploadBoardAttachments(attachments, {
    folder: `dashboard/departmentMessages/${conversation.departmentId}/${currentUserId}/${messageId}`,
    ownerUid: currentUserId,
  });

  await setDoc(doc(db, "departmentMessages", messageId), {
    departmentId: conversation.departmentId,
    departmentName: conversation.departmentName || "Departamento",
    fromUserId: currentUserId,
    fromUserName: profile?.name || "Usuario",
    fromUserEmail: profile?.email || "",
    message,
    attachments: storedAttachments,
    replyToMessageId: replyTarget?.type === "department" ? replyTarget.messageId : "",
    replyToFromUserId: replyTarget?.type === "department" ? replyTarget.fromUserId : "",
    replyToFromUserName: replyTarget?.type === "department" ? replyTarget.fromUserName : "",
    replyToMessage: replyTarget?.type === "department" ? replyTarget.message.slice(0, 240) : "",
    memberIds,
    readBy: {
      [currentUserId]: serverTimestamp(),
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function markDirectMessageAsRead(message, currentUserId) {
  if (!message?.id || message.toUserId !== currentUserId || message.read) return;

  try {
    await updateDoc(doc(db, "internalMessages", message.id), {
      read: true,
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn("No se pudo marcar mensaje rapido como leido:", error);
  }
}

async function markDepartmentMessageAsRead(message, currentUserId) {
  if (!message?.id || !isUnreadDepartmentMessage(message, currentUserId)) return;

  try {
    await updateDoc(doc(db, "departmentMessages", message.id), {
      [`readBy.${currentUserId}`]: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn("No se pudo marcar mensaje de departamento como leido:", error);
  }
}

function buildInternalConversations(messages, collaborators, currentUserId) {
  const collaboratorMap = new Map(collaborators.map((collaborator) => [collaborator.id, collaborator]));
  const grouped = new Map();

  messages.forEach((message) => {
    const otherUser = getInternalMessageParticipant(message, currentUserId);
    if (!otherUser.id) return;

    if (!grouped.has(otherUser.id)) {
      const collaborator = collaboratorMap.get(otherUser.id) || {};
      grouped.set(otherUser.id, {
        participantId: otherUser.id,
        participantName: collaborator.name || otherUser.name || collaborator.email || "Usuario",
        participantEmail: collaborator.email || otherUser.email || "",
        messages: [],
        unreadCount: 0,
        lastMessage: null,
      });
    }

    const conversation = grouped.get(otherUser.id);
    conversation.messages.push(message);
    if (message.toUserId === currentUserId && !message.read) {
      conversation.unreadCount += 1;
    }
  });

  return Array.from(grouped.values())
    .map((conversation) => {
      const sortedMessages = conversation.messages.slice().sort(sortByCreatedAtDesc);
      return {
        ...conversation,
        messages: sortedMessages,
        lastMessage: sortedMessages[0] || null,
      };
    })
    .sort((a, b) => {
      const unreadDiff = Number(b.unreadCount > 0) - Number(a.unreadCount > 0);
      if (unreadDiff !== 0) return unreadDiff;
      return getMillisFromFirestoreDate(b.lastMessage?.createdAt) - getMillisFromFirestoreDate(a.lastMessage?.createdAt);
    });
}

function buildDepartmentChatOptions({ departments, collaborators, profile, currentUserId, isAdmin }) {
  const optionsByKey = new Map();
  const currentUserLabels = getUserDepartmentLabels(profile);
  const currentUserDepartmentKeys = currentUserLabels.map(normalizeText).filter(Boolean);

  function addOption({ id, name, source = "profile", raw = {} }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return;
    const normalizedName = normalizeText(cleanName);
    if (!normalizedName) return;
    const optionId = id || getDepartmentOptionId(cleanName);
    if (!optionsByKey.has(normalizedName)) {
      optionsByKey.set(normalizedName, {
        id: optionId,
        name: cleanName,
        normalizedName,
        source,
        departmentDocId: raw.id || "",
        memberCount: 0,
      });
    }
  }

  departments.forEach((department) => {
    const departmentName = department.name || department.title || "";
    const normalizedName = normalizeText(departmentName);
    if (!departmentName || (!isAdmin && !userBelongsToDepartmentId(profile, department.id) && !currentUserDepartmentKeys.includes(normalizedName))) return;
    addOption({ id: department.id || getDepartmentOptionId(departmentName), name: departmentName, source: "departments", raw: department });
  });

  if (isAdmin) {
    [{ ...profile, id: currentUserId }, ...collaborators].forEach((user) => {
      getUserDepartmentLabels(user).forEach((departmentName) => addOption({ name: departmentName, source: "users" }));
    });
  } else {
    currentUserLabels.forEach((departmentName) => addOption({ name: departmentName, source: "profile" }));
  }

  const users = [{ ...profile, id: currentUserId }, ...collaborators];
  return Array.from(optionsByKey.values())
    .map((option) => ({
      ...option,
      memberCount: getDepartmentMemberIds(option, collaborators, profile, currentUserId).length,
    }))
    .filter((option) => isAdmin || users.some((user) => userBelongsToDepartmentId(user, option.id) || userBelongsToDepartment(user, option.normalizedName)))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function buildDepartmentConversations(messages, departmentOptions, currentUserId) {
  const grouped = new Map();
  const departmentIdByName = new Map();

  departmentOptions.forEach((department) => {
    if (department.normalizedName) {
      departmentIdByName.set(department.normalizedName, department.id);
    }
    grouped.set(department.id, {
      departmentId: department.id,
      departmentName: department.name,
      normalizedName: department.normalizedName,
      memberCount: department.memberCount || 0,
      messages: [],
      unreadCount: 0,
      lastMessage: null,
    });
  });

  messages.forEach((message) => {
    const normalizedName = normalizeText(message.departmentName || "Departamento");
    const departmentId = departmentIdByName.get(normalizedName) ||
      message.departmentId ||
      getDepartmentOptionId(message.departmentName || "Departamento");
    if (!grouped.has(departmentId)) return;

    const conversation = grouped.get(departmentId);
    conversation.messages.push(message);
    if (isUnreadDepartmentMessage(message, currentUserId)) {
      conversation.unreadCount += 1;
    }
  });

  return Array.from(grouped.values())
    .map((conversation) => {
      const sortedMessages = conversation.messages.slice().sort(sortByCreatedAtDesc);
      return {
        ...conversation,
        messages: sortedMessages,
        lastMessage: sortedMessages[0] || null,
      };
    })
    .sort((a, b) => {
      const unreadDiff = Number(b.unreadCount > 0) - Number(a.unreadCount > 0);
      if (unreadDiff !== 0) return unreadDiff;
      const dateDiff = getMillisFromFirestoreDate(b.lastMessage?.createdAt) - getMillisFromFirestoreDate(a.lastMessage?.createdAt);
      if (dateDiff !== 0) return dateDiff;
      return a.departmentName.localeCompare(b.departmentName, "es");
    });
}

function getDepartmentMemberIds(department, collaborators, profile, currentUserId) {
  const normalizedName = department?.normalizedName || normalizeText(department?.name || department?.departmentName || "");
  const userMap = new Map();

  [{ ...profile, id: currentUserId }, ...collaborators].forEach((user) => {
    const userId = user?.id || user?.uid || "";
    if (!userId) return;
    if (userBelongsToDepartmentId(user, department?.departmentId || department?.id) || userBelongsToDepartment(user, normalizedName)) {
      userMap.set(userId, user);
    }
  });

  if (currentUserId) {
    userMap.set(currentUserId, { ...profile, id: currentUserId });
  }

  return Array.from(userMap.keys()).filter(Boolean);
}

function getInternalMessageParticipant(message, currentUserId) {
  if (message.fromUserId === currentUserId) {
    return {
      id: message.toUserId || "",
      name: message.toUserName || "Usuario",
      email: message.toUserEmail || "",
    };
  }

  return {
    id: message.fromUserId || "",
    name: message.fromUserName || "Usuario",
    email: message.fromUserEmail || "",
  };
}

function isUnreadDepartmentMessage(message, currentUserId) {
  if (!message?.id || !currentUserId) return false;
  if (message.fromUserId === currentUserId) return false;
  const readBy = message.readBy || {};
  return !readBy[currentUserId];
}

async function uploadBoardAttachments(items = [], { folder, ownerUid }) {
  const drafts = items.filter((item) => item.status === "draft" && item.file);

  return Promise.all(
    drafts.map(async (item, index) => {
      const safeName = sanitizeStorageFileName(item.name || `archivo-${index + 1}`);
      const storagePath = `${folder}/${Date.now()}-${index + 1}-${safeName}`;
      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, item.file, {
        contentType: item.contentType || undefined,
        customMetadata: {
          uploadedBy: ownerUid || "",
          originalName: item.name || safeName,
        },
      });

      const url = await getDownloadURL(storageRef);
      return {
        name: item.name || safeName,
        url,
        path: storagePath,
        contentType: item.contentType || "",
        size: Number(item.size) || 0,
        type: item.type || getAttachmentType(item.contentType, item.name),
        source: item.source || "",
      };
    })
  );
}

function createDraftAttachment(file, metadata = {}) {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name: file.name,
    size: file.size || 0,
    contentType: file.type || guessContentTypeFromName(file.name),
    type: getAttachmentType(file.type, file.name),
    source: metadata.source || "",
    file,
    previewUrl: file.type?.startsWith("image/") ? URL.createObjectURL(file) : "",
    status: "draft",
  };
}

function revokeDraftAttachmentPreviews(items) {
  if (!Array.isArray(items)) return;
  items.forEach((item) => {
    if (item?.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
  });
}

function validateBoardFiles(files, currentCount = 0) {
  if (!files.length) {
    return { valid: true, message: "" };
  }

  if (currentCount + files.length > 6) {
    return { valid: false, message: "Solo puedes adjuntar hasta 6 archivos por mensaje." };
  }

  for (const file of files) {
    const type = getAttachmentType(file.type, file.name);
    const maxSize = type === "video" ? 80 * 1024 * 1024 : 25 * 1024 * 1024;
    if (file.size > maxSize) {
      return {
        valid: false,
        message:
          type === "video"
            ? `El video "${file.name}" supera el limite de 80 MB.`
            : `El archivo "${file.name}" supera el limite de 25 MB.`,
      };
    }
  }

  return { valid: true, message: "" };
}

function normalizeStoredAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((attachment) => attachment && typeof attachment === "object")
    .map((attachment, index) => ({
      id: attachment.id || attachment.path || attachment.url || `stored-${index}`,
      name: attachment.name || "Archivo",
      url: attachment.url || "",
      path: attachment.path || "",
      contentType: attachment.contentType || "",
      size: Number(attachment.size) || 0,
      type: attachment.type || getAttachmentType(attachment.contentType, attachment.name),
      source: attachment.source || "",
      status: "stored",
    }))
    .filter((attachment) => attachment.url || attachment.path);
}

function isAudioOnlyMessage(message) {
  return isAudioMessage(message, getAttachmentType);
}

function getAttachmentType(contentType, fileName = "") {
  const type = String(contentType || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  const looksLikeRecordedAudio = /^audio-\d{4}-\d{2}-\d{2}t.+\.webm$/i.test(name);

  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/") || looksLikeRecordedAudio) return "audio";
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return "image";
  if (/\.(mp4|mov|webm|m4v)$/i.test(name)) return "video";
  if (/\.(mp3|wav|ogg|m4a|webm)$/i.test(name)) return "audio";
  return "document";
}

function getAttachmentTypeLabel(type) {
  if (type === "image") return "Imagen";
  if (type === "video") return "Video";
  if (type === "audio") return "Audio";
  return "Archivo";
}

function guessContentTypeFromName(fileName = "") {
  const name = fileName.toLowerCase();
  if (/\.(png)$/i.test(name)) return "image/png";
  if (/\.(jpe?g)$/i.test(name)) return "image/jpeg";
  if (/\.(webp)$/i.test(name)) return "image/webp";
  if (/\.(mp4)$/i.test(name)) return "video/mp4";
  if (/\.(webm)$/i.test(name)) return "video/webm";
  if (/\.(mp3)$/i.test(name)) return "audio/mpeg";
  if (/\.(pdf)$/i.test(name)) return "application/pdf";
  return "application/octet-stream";
}

function sanitizeStorageFileName(fileName = "archivo") {
  return String(fileName)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "archivo";
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeNoteColor(color) {
  return NOTE_COLOR_OPTIONS.some((option) => option.value === color) ? color : "yellow";
}

const AUDIO_MIME_CANDIDATES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

function pickSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  return AUDIO_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
}

function getAudioFileExtension(mimeType = "") {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("mp4")) return "m4a";
  if (type.includes("aac")) return "aac";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

function getVoiceRecordingErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Permiso de microfono denegado. Revisa los permisos del navegador.";
  }

  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "No se encontro un microfono disponible.";
  }

  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return "El microfono esta ocupado o bloqueado por otra aplicacion.";
  }

  return "No se pudo grabar audio.";
}

function formatVoiceRecordingDuration(milliseconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getCurrentUserId(profile) {
  return (
    auth.currentUser?.uid ||
    profile?.uid ||
    profile?.id ||
    profile?.userId ||
    profile?.authUid ||
    ""
  );
}

function getUserDepartmentLabels(user = {}) {
  return [
    user?.area,
    user?.department,
    user?.departmentName,
    user?.team,
    ...(Array.isArray(user?.departmentNames) ? user.departmentNames : []),
    ...(Array.isArray(user?.departments) ? user.departments : []),
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .filter((value, index, array) => array.findIndex((item) => normalizeText(item) === normalizeText(value)) === index);
}

function userBelongsToDepartment(user = {}, normalizedDepartmentName = "") {
  if (!normalizedDepartmentName) return false;
  return getUserDepartmentLabels(user).some((departmentName) => normalizeText(departmentName) === normalizedDepartmentName);
}

function getDepartmentOptionId(departmentName = "") {
  const slug = normalizeText(departmentName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || `department-${Date.now()}`;
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getMillisFromFirestoreDate(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return new Date(value).getTime() || 0;
  return 0;
}

function sortByCreatedAtDesc(a, b) {
  return getMillisFromFirestoreDate(b.createdAt) - getMillisFromFirestoreDate(a.createdAt);
}

function sortByCreatedAtAsc(a, b) {
  return getMillisFromFirestoreDate(a.createdAt) - getMillisFromFirestoreDate(b.createdAt);
}

function sortPersonalNotes(a, b) {
  if (Boolean(a.completed) !== Boolean(b.completed)) {
    return a.completed ? 1 : -1;
  }

  if (Boolean(a.pinned) !== Boolean(b.pinned)) {
    return a.pinned ? -1 : 1;
  }

  return getMillisFromFirestoreDate(b.updatedAt || b.createdAt) - getMillisFromFirestoreDate(a.updatedAt || a.createdAt);
}

function formatBadgeCount(count) {
  const numericCount = Number(count) || 0;
  return numericCount > 99 ? "99+" : String(numericCount);
}

function truncateText(value = "", maxLength = 70) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}
