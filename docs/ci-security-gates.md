# Puertas CI de seguridad

## Estado al 25 de agosto de 2026

**`package.json` declara 104 scripts; `.github/workflows/ci.yml` ejecuta 15.** Quedan 89 fuera de toda puerta de merge.

La causa raíz es que **CI no levanta PostgreSQL/PostGIS**: el workflow sólo declara un servicio Redis, por lo que ninguna suite que necesite base de datos puede correr. Eso deja fuera de la puerta a todo el núcleo de riesgo:

`test:postgres` · `test:rls` · `test:audit-immutability` · `test:sensitive-data` · `test:mfa` · `test:payment-reconciliation` · `test:marketplace-ledger` · `test:mercadopago-payment` · `test:mercadopago-webhook` · `test:payment-oauth` · `test:payout-review` · `test:transaction-risk` · `test:driver-kyc` · `test:driver-vehicles` · `test:ride-safety` · `test:support-sla` · `test:support-routing` · `test:city-isolation` · `test:maps`

Consecuencia directa: **el repositorio puede tener 104 scripts, pero sin puertas bloqueantes no existe garantía continua** sobre migraciones, RLS, pagos, ledger, webhooks, refunds, dispatch, KYC, safety, soporte ni aislamiento por ciudad. Una regresión en cualquiera de esos caminos entra a `main` sin resistencia.

Este es el hallazgo [H-01](auditoria-2026-08-25.md#h-01--ci-no-ejecuta-el-86-de-su-propia-matriz-de-pruebas) y se corrige con el ticket [CI-001](backlog-tecnico.md#ci-001--pipeline-productivo).

### Comprobar la brecha

```bash
node -e "const p=require('./package.json'),ci=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const s=Object.keys(p.scripts);console.log(s.length,'declarados /',s.filter(x=>ci.includes('npm run '+x)).length,'en CI')"
```

## Lo que sí corre hoy

`check` (build + `test:security`) · `test:responsive-layout` · `test:web-bundle-budget` · `test:web-delivery` · `test:openapi-contract` · `test:graceful-shutdown` · `test:secrets` · `test:dependency-gate` · `test:telemetry` · `test:observability-rules` · `test:provider-resilience` · `test:container-security` · `test:redis-rate-limit` · `mobile:typecheck` · `test:mobile-native-runtime` · `test:mobile-build-variants`.

Son casi todas puertas de **infraestructura** (build, bundle, entrega HTTP, telemetría, apagado ordenado, rate limiting), no de **dominio**.

### Escáner de secretos

Revisa archivos tracked y nuevos no ignorados buscando claves privadas y formatos de credenciales AWS, GitHub, Slack, Stripe live y Google. No imprime secretos, sólo ruta, línea y tipo.

### Gate de dependencias

Bloquea vulnerabilidades **altas o críticas** en runtime web/API y mobile. Al 22-08-2026 ambos árboles reportaban cero vulnerabilidades conocidas. Mobile fija parches compatibles de Metro y reemplaza las versiones transitivas vulnerables de `image-size` y `uuid` mediante `overrides`; TypeScript, configuración Expo y bundles web/iOS/Android forman parte de la verificación antes de conservar esos overrides.

### Contrato de contenedor

`test:container-security` valida principalmente separación de roles de PostgreSQL: owner/migrador, runtime y auditor, y rechaza roles con `BYPASSRLS`. **No valida** usuario Linux, capabilities, seccomp ni filesystem de sólo lectura — ver el hallazgo [H-05](auditoria-2026-08-25.md#h-05--la-imagen-docker-no-corresponde-al-arranque-real-y-corre-como-root) y el ticket [INF-001](backlog-tecnico.md#inf-001--imagen-productiva-endurecida).

## Arquitectura objetivo

Cuatro workflows sustituyen al `ci.yml` único.

| Workflow | Cuándo | Contenido |
| --- | --- | --- |
| `ci-fast.yml` | Cada PR | Typecheck · lint · unit tests · static security · secret scan · build · bundle budget · control de longitud de línea |
| `ci-postgres.yml` | Cada PR | PostgreSQL/PostGIS · migraciones desde cero · migraciones desde snapshot anterior · RLS · audit chain · runtime smoke · city isolation · idempotencia |
| `ci-critical-flows.yml` | Cada PR | Pago · webhook · refund · ledger · dispatch · reconciliation · KYC · support SLA · safety |
| `ci-nightly.yml` | Cada noche | Playwright E2E · performance · load · provider sandbox · restore drill · dependency scan completo · mobile build preview |

Servicio PostgreSQL requerido en `ci-postgres.yml` y `ci-critical-flows.yml`:

```yaml
services:
  postgres:
    image: postgis/postgis:17-3.5
    env:
      POSTGRES_PASSWORD: ci
      POSTGRES_DB: flash
    ports: ["5432:5432"]
    options: >-
      --health-cmd "pg_isready -U postgres"
      --health-interval 5s --health-timeout 3s --health-retries 20
```

## Reglas de merge objetivo

- La rama `main` protegida, con PR obligatoria.
- Un PR bloqueado si falla cualquier suite crítica.
- Dos aprobaciones para cambios en pagos y seguridad, vía `CODEOWNERS`.
- Artefactos de test almacenados y consultables tras el run.
- **Ningún script de riesgo fuera de una puerta sin justificación escrita** en [`docs/backlog-tecnico.md`](backlog-tecnico.md).

### Verificación de cobertura completa

```bash
node -e "const p=require('./package.json'),fs=require('fs');const ci=fs.readdirSync('.github/workflows').map(f=>fs.readFileSync('.github/workflows/'+f,'utf8')).join('');const out=Object.keys(p.scripts).filter(s=>s.startsWith('test:')&&!ci.includes('npm run '+s));console.log(out.length?'FUERA DE CI:\n'+out.join('\n'):'OK: toda suite de test está en CI')"
```
