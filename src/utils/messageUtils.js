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
