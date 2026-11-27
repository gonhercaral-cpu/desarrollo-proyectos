import { useEffect, useState } from "react";
import PrintProduction from "./PrintProduction";
import { subscribeProduction } from "./service";

export default function ProductionWorkspace(props) {
  const { isAdmin } = props;
  const [retry, setRetry] = useState(0);
  const [errors, setErrors] = useState({});
  const [data, setData] = useState({});
  useEffect(() => subscribeProduction({
    isAdmin,
    onData(name, value) {
      setData((current) => ({ ...current, [name]: value }));
      setErrors((current) => ({ ...current, [name]: null }));
    },
    onError(name, error) {
      setErrors((current) => ({ ...current, [name]: error.message }));
    },
  }), [isAdmin, retry]);

  if (Object.values(errors).some(Boolean)) {
    return <section role="alert" className="message-box">
      <p>No se pudo cargar la información del Gestor. {Object.values(errors).find(Boolean)}</p>
      <button type="button" onClick={() => setRetry((value) => value + 1)}>Volver a conectar</button>
    </section>;
  }
  if (!data.jobs || !data.settings || !data.printers || !data.materials || !data.productionTemplates || (isAdmin && !data.agents)) {
    return <p role="status" className="message-box">Cargando trabajos y equipos de Imprenta…</p>;
  }
  return <PrintProduction {...props} agents={[]} {...data} />;
}
