# Flash Delivery Mobility

MVP fullstack para operar comida, delivery y viajes tipo taxi/conductor en una sola plataforma.

En escritorio se muestra solo la consola de superadministrador. La experiencia de cliente, comercio y conductor/repartidor queda como app mobile/PWA.

## Levantar la app

```bash
npm install
npm run dev
```

- Frontend: http://127.0.0.1:5173/
- Backend: http://127.0.0.1:4000/api/health
- Readiness: http://127.0.0.1:4000/api/ready
- Realtime: http://127.0.0.1:4000/api/events (requiere JWT en Authorization)
- Base SQLite: `server/data/flash.sqlite`

Produccion local con Docker:

```bash
docker compose up --build
```

Luego abrir http://127.0.0.1:4000/

## Verificacion

```bash
npm run build
npm run test:security
npm run check
```

`test:security` levanta una API aislada en otro puerto, prueba JWT/RBAC/ownership y reinicia los datos demo al terminar.

## Configuracion

Copiar `.env.example` como referencia para ambientes reales. Variables principales:

- `NODE_ENV`: `development`, `test` o `production`.
- `HOST` y `PORT`: direccion y puerto del backend.
- `JWT_SECRET`: obligatorio y fuerte para produccion.
- `CORS_ORIGIN`: allowlist separada por comas.
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`: limites de abuso.

El backend responde con `requestId`, aplica headers de seguridad, CORS controlado y rate limiting. En produccion no arranca con el secreto JWT demo.

## Cuentas demo

- Cliente: `cliente@flash.app` / `demo123`
- Comercio: `comercio@flash.app` / `demo123`
- Conductor/repartidor: `conductor@flash.app` / `demo123`
- Operaciones: `ops@flash.app` / `demo123`

## Flujos funcionales

- Cliente: pedir comida, carrito, checkout, cancelar pedidos, cotizar taxi, pedir taxi, tracking y wallet.
- Comercio: abrir/pausar local, avanzar pedidos de cocina, administrar stock y crear platos.
- Conductor/repartidor: activar disponibilidad, cambiar modo delivery/taxi, aceptar pedidos/viajes y avanzar estados.
- Operaciones: metricas en vivo, mapa operativo, pedidos/viajes activos, tickets y reinicio de demo.
- Realtime: las superficies autenticadas reciben eventos SSE de pedidos, viajes, comercios y drivers, con reconexion automatica.
- Geolocalizacion: origen de taxi por GPS del dispositivo, cotizacion por coordenadas y posicion foreground del driver.

Los datos se persisten en SQLite. Las rutas sensibles usan JWT, RBAC y validacion de propiedad por cliente, comercio y driver. Para volver al estado inicial desde la UI, entrar a `Ops` o al superadmin desktop y usar `Reiniciar demo`.

## Documentacion de producto

- Roadmap ejecutivo: `ROADMAP.MD`
- Apps nativas base: `apps/mobile/README.md`
- Investigacion competitiva: `docs/investigacion-competitiva.md`
- Investor readiness: `docs/investor-readiness.md`
- Arquitectura: `docs/arquitectura-producto.md`
- Infraestructura escalable: `docs/infraestructura-escalable.md`
- Realtime: `docs/realtime.md`
- Roadmap: `docs/roadmap.md`
- Progreso: `docs/progreso.md`
- Checklist de despliegue: `docs/deployment-checklist.md`
