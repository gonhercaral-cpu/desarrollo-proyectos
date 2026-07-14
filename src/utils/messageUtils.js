export function isAudioMessage(message, getAttachmentType) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  return attachments.length > 0 && attachments.every((item) => getAttachmentType(item.contentType, item.name) === "audio");
}

export function getMessagePreview(message, getAttachmentType) {
  if (isAudioMessage(message, getAttachmentType)) return "Mensaje de audio";
  const text = String(message?.message || "").trim();
  if (text && text.toLowerCase() !== "archivo adjunto") return text;
  return message?.attachments?.length ? "Archivo adjunto" : text;
}

const MESSAGE_URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const TRAILING_URL_PUNCTUATION = /[.,!?;:)\]}]$/;

export function parseMessageText(text = "") {
  const value = String(text || "");
  const parts = [];
  let lastIndex = 0;

  value.replace(MESSAGE_URL_PATTERN, (match, _url, offset) => {
    if (offset > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, offset) });
    }

    let url = match;
    let trailingText = "";

    while (url && TRAILING_URL_PUNCTUATION.test(url)) {
      trailingText = `${url.slice(-1)}${trailingText}`;
      url = url.slice(0, -1);
    }

    if (url) {
      parts.push({
        type: "link",
        value: url,
        href: /^www\./i.test(url) ? `https://${url}` : url,
      });
    }

    if (trailingText) {
      parts.push({ type: "text", value: trailingText });
    }

    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value }];
}

export function getDepartmentReadReceipt(message, profiles = []) {
  const senderId = String(message?.fromUserId || "");
  const readerIds = Object.keys(message?.readBy || {}).filter((userId) => userId && userId !== senderId);
  const profilesById = new Map(
    (profiles || []).map((profile) => [String(profile?.id || profile?.uid || ""), profile])
  );

  return {
    count: readerIds.length,
    names: readerIds.map((userId) => {
      const readerProfile = profilesById.get(userId) || {};
      return String(
        readerProfile.name ||
          readerProfile.displayName ||
          readerProfile.fullName ||
          readerProfile.email ||
          "Usuario sin nombre"
      ).trim();
    }),
  };
}
