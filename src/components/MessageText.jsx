import { parseMessageText } from "../utils/messageUtils";

export default function MessageText({ text = "" }) {
  return parseMessageText(text).map((part, index) =>
    part.type === "link" ? (
      <a key={`${part.href}-${index}`} href={part.href} target="_blank" rel="noopener noreferrer">
        {part.value}
      </a>
    ) : (
      <span key={`text-${index}`}>{part.value}</span>
    )
  );
}
