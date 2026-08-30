# Estrategia de KYC automatizado y verificación continua

**Estado:** diseño post-Fase 0 · **no implementado** · **no habilita operación ni reemplaza asesoramiento legal**.

Este documento convierte el objetivo de reducir trabajo humano en verificaciones de identidad
en una arquitectura medible, auditable y homologable. No autoriza a presentar un modelo propio,
un proveedor sandbox o una selfie local como KYC productivo.

## Decisión ejecutiva

Flash buscará **procesamiento directo de los casos de alta confianza** y revisión humana por
excepción. El objetivo no es «cero personas» como premisa: una identidad ambigua, una posible
suplantación o una decisión que quite acceso laboral o financiero necesita explicación,
reintento, apelación y revisión proporcional al riesgo.

La competencia confirma este límite. Uber combina verificaciones de identidad en tiempo real,
señales de fraude y frecuencia adaptativa; cuando la tecnología marca posible fraude, declara
una revisión humana antes de actuar y un mecanismo para apelar. Lyft permite reintentar una
captura y deriva a soporte cuando no puede verificarla. Flash automatizará el camino normal y
mantendrá intervención sólo en excepciones y decisiones adversas.

## Alcance previsto

1. **Driver y courier:** documento, licencia, selfie/liveness, coincidencia facial, vehículo,
   vencimientos y reverificación basada en riesgo.
2. **Comercio:** identidad de representantes, existencia y titularidad, cuenta de liquidación y
   beneficiario final cuando lo exijan PSP o regulación.
3. **Cliente:** verificación escalonada sólo para señales de fraude, viajes, artículos
   restringidos o acciones financieras de mayor riesgo.
4. **Operación:** cola de excepciones, evidencia minimizada, motivo legible, doble control para
   acciones críticas y apelación.

No se reutilizará biometría para publicidad, scoring comercial, personalización o entrenamiento
de modelos sin una finalidad nueva, base legal, consentimiento y evaluación separada.

## Flujo objetivo

```text
consentimiento y propósito
  -> captura guiada y control de calidad local
  -> autenticidad del documento + fuente emisora
  -> liveness + vínculo rostro/documento cuando corresponda
  -> reglas determinísticas de elegibilidad
  -> score de fraude versionado
  -> aprobar | pedir recaptura | revisión excepcional
  -> notificar motivo, vigencia y canal de apelación
  -> reverificar por vencimiento, evento o riesgo
```

### 1. Captura y calidad

- SDK aislado detrás de un adaptador sustituible; ninguna pantalla habla con un proveedor
  directamente.
- Consentimiento informado antes de biometría, finalidad visible y alternativa accesible.
- Control local de encuadre, reflejo, desenfoque, documento completo y presencia viva para
  evitar subir capturas inútiles.
- El cliente nunca decide autenticidad ni aprobación; sólo captura y muestra estado.

### 2. Evidencia y fuentes

- OCR extrae campos, pero la política usa la respuesta firmada del proveedor o la fuente
  autoritativa, no texto enviado por el dispositivo.
- Se valida tipo, emisor, vigencia, integridad, señales de manipulación y coherencia entre
  documento, sesión y datos declarados.
- Cada evidencia registra proveedor, versión de política/modelo, timestamp, calidad, resultado,
  motivo y correlación; los archivos sensibles permanecen cifrados y fuera de logs.

### 3. Motor de decisión

- Las reglas legales y operativas son determinísticas, versionadas y separadas del modelo.
- Un modelo puede priorizar, detectar anomalías o pedir otra prueba; no inventa requisitos ni
  modifica umbrales en producción sin aprobación y despliegue auditable.
- Estados canónicos: `pending_capture`, `processing`, `retry_required`, `manual_review`,
  `approved`, `rejected`, `expired`, `suspended_pending_review`.
- Los fallos técnicos, baja calidad o incertidumbre producen reintento o excepción; nunca un
  rechazo definitivo silencioso.

### 4. Verificación continua

- Reverificación por vencimiento, cambio de dispositivo o datos, señal de cuenta compartida,
  incidente o muestra aleatoria con presupuesto de fricción.
- La frecuencia surge de riesgo observable y política, no de características protegidas.
- Un match fallido bloquea sólo la operación de riesgo mientras se revisa; no borra cuenta,
  fondos, historial ni derecho de apelación.

## Arquitectura prevista

- `IdentityProofingProvider`: crear sesión, recibir webhook firmado, consultar resultado y
  eliminar evidencia.
- `KycPolicyEngine`: reglas puras por país, rol, vehículo, servicio y nivel de garantía.
- `KycCaseRepository`: caso, evidencia, decisiones, vencimientos, revisiones y apelaciones en
  PostgreSQL con RLS y auditoría append-only.
- `KycRiskOrchestrator`: combina señales internas y resultados del proveedor sin mantener una
  transacción SQL durante llamadas externas.
- Outbox/workers: webhooks idempotentes, reintentos acotados, dead-letter, alertas y
  reconciliación contra el proveedor.
- Feature flags por ciudad/rol/proveedor y kill switch operativo sin despliegue.

La biometría cruda no se usará como identificador general de la plataforma. Se conservará el
mínimo necesario durante el plazo legal/contractual definido; cualquier template o referencia
debe tener cifrado, acceso privilegiado, rotación y borrado verificable.

## Selección y homologación de proveedor

Antes de elegir o integrar se ejecutará un RFP con evidencia, no una comparación comercial de
features. Criterios bloqueantes:

- cobertura documental y fuentes autoritativas para el país de lanzamiento;
- liveness y anti-spoof probados por laboratorio independiente;
- métricas de falsos matches y falsos rechazos por grupos relevantes, con umbrales y método;
- residencia, transferencias internacionales, subprocesadores, DPA, borrado y exportación;
- ISO 27001/SOC 2 u otra certificación aplicable, pentest y gestión de incidentes vigentes;
- SDK accesible, soporte mobile, SLA, timeout, idempotencia, webhooks firmados y sandbox honesto;
- precio por intento, reintento, revisión y reverificación; límites contra abuso y costos;
- portabilidad de casos y salida contractual sin quedar cautivo de templates propietarios.

## Métricas y controles

| Métrica | Uso |
| --- | --- |
| tasa de procesamiento directo | medir cuánto trabajo humano se evitó realmente |
| tasa de recaptura y abandono | detectar fricción o mala captura |
| falso match / falso no-match | seguridad y exclusión injusta |
| revisión y reversión por motivo | calidad del motor y del proveedor |
| tiempo a aprobación P50/P95 | experiencia y SLA operativo |
| costo por caso aprobado | unit economics, incluidos reintentos |
| incidentes de suplantación posteriores | eficacia real, no sólo score del proveedor |

Ninguna meta se fija antes de obtener una línea base. «90% automatizado» o cualquier cifra
similar será un objetivo sólo después de medir documentos, dispositivos y población reales.

## Puertas antes de producción

- [ ] Proveedor y país elegidos mediante RFP; contrato, DPA y subprocesadores aprobados.
- [ ] DPIA/evaluación de impacto, threat model biométrico y revisión legal local completados.
- [ ] Consentimiento, aviso de privacidad, retención, eliminación y apelación probados.
- [ ] Dataset de evaluación representativo y autorizado; pruebas de spoof, replay y documento
      manipulado con resultados por cohorte.
- [ ] Webhooks firmados, idempotencia, reconciliación, rate limits, alertas y kill switch en CI y
      staging.
- [ ] Revisión independiente de seguridad, privacidad, sesgo y accesibilidad.
- [ ] Piloto controlado con evidencia física; falsos rechazos y reversión dentro del umbral
      aprobado.
- [ ] Autoridad, PSP, aseguradora y operación aceptan el proceso donde corresponda.

Hasta cerrar todas las puertas, KYC permanece `CI` o por debajo y cualquier aprobación local es
una prueba técnica, no una homologación.

## Referencias rectoras

- [NIST SP 800-63A-4 — Identity Proofing](https://pages.nist.gov/800-63-4/sp800-63a.html)
- [AAIP — guía para IA responsable y decisiones automatizadas](https://www.argentina.gob.ar/sites/default/files/aaip-argentina-guia_para_usar_la_ia_de_manera_responsable.pdf)
- [Ley argentina 25.326 — protección de datos](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/texto)
- [FATF — Guidance on Digital Identity](https://www.fatf-gafi.org/content/dam/fatf-gafi/guidance/Guidance-on-Digital-Identity.pdf.coredownload.pdf)
- [Uber — verificación continua y revisión humana](https://www.uber.com/us/en/newsroom/courier-identity-us/)
- [Uber — revisión por desactivación](https://www.uber.com/us/en/drive/driver-app/deactivation-review/)
- [Lyft — verificación fotográfica y excepción](https://help.lyft.com/hc/en-us/driver/articles/360022461073-Lyft-Direct)
