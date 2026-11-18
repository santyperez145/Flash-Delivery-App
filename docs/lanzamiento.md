# Camino al lanzamiento

**Al 18 de noviembre de 2026.** Qué separa a Flash de tener pedidos reales en la calle, quién
tiene cada pieza y en qué orden. Junta lo que estaba repartido entre
[`despliegue.md`](despliegue.md), [`deployment-checklist.md`](deployment-checklist.md),
[`plan-de-accion.md`](plan-de-accion.md) e [`investor-readiness.md`](investor-readiness.md);
cuando un dato vive en uno de ellos, acá se enlaza en lugar de repetirse.

## El objetivo: el piloto de La Rioja

Ya está definido en el plan de acción y no cambia: **15–25 comercios, 20–40 repartidores y
300–500 usuarios invitados**, en una zona y un horario acotados, **comida y envíos, sin viajes
públicos** —no hay marco legal confirmado para movilidad en La Rioja—. El piloto cierra con
el contribution margin por pedido calculable, que es la puerta económica de la Fase 2.

Lanzar significa que un cliente real pague un pedido real, que un comercio real lo prepare,
que un repartidor real lo entregue y cobre, y que la plata cierre en el ledger y en la
cuenta de Mercado Pago.

## Dónde estamos, sin maquillar

- **Producto:** la base de un marketplace de comida, envíos y viajes está construida y con
  puertas: pedidos, despacho, pagos con split, wallet, propinas, suscripción, pedidos
  grupales, programados, retiro en el local, rubros y preferencias de entrega. Los huecos que
  quedan frente a Uber, Uber Eats y PedidosYa están en
  [`paridad-competitiva.md`](paridad-competitiva.md).
- **Probado contra proveedores reales: nada.** Ninguna capacidad pasó de `CI` a `PROV` en la
  [matriz de madurez](matriz-madurez.md): ni pagos, ni push, ni mapas, ni SMS, ni correo.
  Todo lo que depende de un tercero está construido y verificado contra contratos simulados,
  y tiene que probarse con credenciales reales antes de tocar plata de nadie.
- **Desplegado: nada.** El destino está decidido (GCP, `southamerica-east1`, ver
  [`despliegue.md`](despliegue.md)) y ninguno de sus pasos se ejecutó.
- **Requisito de tienda cerrado en código:** el borrado de cuenta desde la app (LAN-001)
  está construido y con puerta en web y en las tres apps. Queda definir con la asesoría
  legal el plazo de conservación de los registros que se anonimizan.

## El camino crítico

Las etapas se superponen: lo del dueño arranca ya y en paralelo, porque varias cuentas
tardan días o semanas en aprobarse.

### 1. Cuentas y credenciales — del dueño, en paralelo, empezar ya

Ordenadas por cuánto bloquean. Ninguna la puede crear el equipo de ingeniería: son cuentas
a nombre de la empresa, con facturación y datos legales.

| # | Qué | Para qué | Tiempo típico de alta |
| --- | --- | --- | --- |
| 1 | **Cuenta de Mercado Pago para marketplace** y aplicación con credenciales productivas | Cobrar y repartir el dinero entre comercio, repartidor y plataforma | Días; la aprobación del marketplace la decide Mercado Pago |
| 2 | **Proyecto de GCP con facturación** | Todo el despliegue | Horas |
| 3 | **Apple Developer Program** y **Google Play Console** | Publicar las apps | Apple: días (verificación de la empresa); Google: horas a días |
| 4 | **Dominio** y **proveedor de correo** (SMTP con SPF/DKIM) | Verificación de cuentas, recibos, recuperación de contraseña | Horas |
| 5 | **API key comercial de mapas** con tope de gasto | Geocoding, rutas y ETA vial (GEO-001, DSP-001) | Horas |
| 6 | **Proveedor de SMS** | Verificación de teléfono | Días (registro del remitente) |
| 7 | **Cuenta de Sentry** | Errores en producción | Minutos |
| 8 | **Dos teléfonos de prueba** (Android y iPhone) | Probar push y la app instalada (NOT-001, MOB-001) | — |

### 2. Legal y fiscal — del dueño, con asesoría profesional

El equipo de ingeniería no da asesoramiento legal ni fiscal. Lo que sigue es **la lista de
temas a resolver con un abogado y un contador**, no una conclusión sobre cada uno:

- Forma jurídica, inscripción fiscal y **facturación electrónica de las comisiones**; el
  tratamiento fiscal del split de pagos está señalado como riesgo en
  [`investor-readiness.md`](investor-readiness.md).
- **Términos y condiciones** y **política de privacidad** para clientes, comercios y
  repartidores. Las tiendas exigen una URL pública de la política de privacidad.
- **Datos personales:** inscripción de las bases de datos y ejercicio de los derechos de
  acceso y supresión según la Ley 25.326. El borrado de cuenta (LAN-001) es la parte técnica
  de la supresión.
- **Relación con los repartidores** y **seguro** de accidentes.
- Restricciones por rubro: farmacia (los medicamentos exigen farmacia habilitada, P-10) y
  bebidas alcohólicas.

### 3. Ingeniería sin credenciales — del equipo, ya

Lo que se puede hacer hoy, en este orden:

1. ~~**LAN-001 — Borrado de cuenta desde la app.**~~ Hecho: requisito de Apple y Google para
   publicar.
   - **Cómo lo hace la competencia** (consultado el 18-11-2026):
     - **Uber y Uber Eats:** borrar la cuenta la desactiva 30 días, y volver a entrar en ese
       plazo la recupera; después se borra. Fuentes de terceros coincidentes, como la
       [guía de IONOS](https://www.ionos.com/digitalguide/online-marketing/social-media/delete-uber-account.md);
       no se leyó la ayuda oficial.
     - **PedidosYa:** no se encontró una guía oficial. Reclamos públicos de usuarios en
       [tuquejasuma.com](https://tuquejasuma.com/pedidos-ya/reclamos/dar-de-baja-la-cuenta)
       dicen que no hay opción en la app y que se pide a atención al cliente. No es una
       fuente oficial.
   - **Flash borra al instante y sin plazo de arrepentimiento.** Cumple lo que piden las
     tiendas y es más fuerte que pedirlo a soporte.
   - El plazo de 30 días de Uber evita borrados por error. Es una decisión de producto
     pendiente: agregarlo exige que la cuenta quede suspendida, no anonimizada, durante el
     plazo.
2. ~~**Infraestructura como código para GCP**~~, en [`infra/gcp`](../infra/gcp/README.md).
   - Hecho: Terraform validado en CI, con despliegue en dos fases porque Cloud Run lee los
     secretos al crear cada revisión.
   - Falta el workflow que publica la imagen y aplica. Se escribe con la cuenta, porque
     necesita la identidad federada de GitHub en el proyecto.
3. ~~**Enlaces legales en la app** (términos, privacidad) apuntando a las URLs que defina el
   dueño, con el estado honesto mientras no existan.~~ Hecho (LAN-002).
   - El día que existan los documentos, alcanza con cargar `LEGAL_TERMS_URL` y
     `LEGAL_PRIVACY_URL` en el servidor.
   - En producción las dos son obligatorias.
4. **Paridad que el piloto necesita:** foto al dejar en la puerta (P-02b) y retiro desde el
   móvil (P-11). El resto de [`paridad-competitiva.md`](paridad-competitiva.md) no bloquea
   el piloto.
5. **Material de tiendas:** capturas, descripción, clasificación de contenido y formularios
   de datos (Data Safety de Google, etiquetas de privacidad de Apple), a partir de lo que la
   app realmente recolecta.

### 4. Validación con proveedores reales — del equipo, cuando existan las cuentas

Cada capacidad sube de `CI` a `PROV` con evidencia, como exige la matriz de madurez:

- Pago real de punta a punta con Mercado Pago en sandbox y después con un monto mínimo
  real; ledger balanceado y conciliación diaria corrida.
- Push recibido en los dos teléfonos.
- Geocoding y rutas contra el proveedor comercial, con alerta de costo.
- Staging con datos separados; restore drill cronometrado contra el RTO de 60 minutos.
- Builds internos de las apps instalados en los dos teléfonos.

### 5. Operación del piloto — del dueño, con soporte del equipo

- **Comercios reales:** 15–25, con catálogo, horarios y cuenta de Mercado Pago vinculada.
  Sin comercios no hay producto: la portada muestra lo que existe, y no se siembran
  comercios ficticios.
- **Repartidores:** 20–40, con KYC aprobado y vehículo revisado.
- **Soporte** con el SLA que ya mide la plataforma, y una persona de operaciones con MFA.
- **Beta cerrada** con usuarios invitados; recién después, apertura de la zona.

## Lo que necesito del dueño, en orden

1. **Cuenta de Mercado Pago para marketplace** — es la que más tarda y la que más bloquea.
2. **Proyecto de GCP con facturación.**
3. **Apple Developer y Google Play Console.**
4. **Asesoría legal y contable** sobre los temas de la sección 2.
5. **Dominio, correo, mapas, SMS y Sentry.**
6. **Los primeros comercios y repartidores del piloto.**

Cada cuenta que se abre destraba trabajo que ya está escrito y esperando: el detalle de qué
hace el equipo con cada una está en [`deployment-checklist.md`](deployment-checklist.md).
