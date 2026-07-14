import { getDepartmentReadReceipt } from "../utils/messageUtils";

export default function DepartmentReadReceipt({ message, profiles = [] }) {
  const receipt = getDepartmentReadReceipt(message, profiles);
  const names = receipt.names.length > 0 ? receipt.names : ["Nadie más lo ha visto"];

  return (
    <details className="message-read-receipt">
      <summary>Visto por {receipt.count}</summary>
      <div className="message-read-receipt-names" role="tooltip">
        {names.map((name, index) => (
          <span key={`${name}-${index}`}>{name}</span>
        ))}
      </div>
    </details>
  );
}
