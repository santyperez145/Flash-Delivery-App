// Primitivas de panel compartidas (ticket ARC-001, paso 9).
//
// El prefijo `Admin` es un nombre heredado y equivocado: `AdminKpi` se usa en 4
// lugares fuera del backoffice y `AdminSectionHeader` en 10. Se conservan los
// nombres para que la extracción no mezcle mover con renombrar, y queda anotado
// como deuda: renombrarlas es un cambio mecánico separado.
//
// Están acá y no en la consola porque un módulo compartido que importara de
// vuelta a la consola —o a `App.tsx`— cerraría un ciclo de imports.
export function AdminKpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: string;
}) {
  return (
    <article className={`admin-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function AdminSectionHeader({ title, action }: { title: string; action: string }) {
  return (
    <div className="admin-section-header">
      <h2>{title}</h2>
      <span>{action}</span>
    </div>
  );
}
