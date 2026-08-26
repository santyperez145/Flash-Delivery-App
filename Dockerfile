# Imagen productiva endurecida (ticket INF-001, hallazgo H-05).
#
# La versión anterior tenía una sola etapa, conservaba las dependencias de
# desarrollo, copiaba el repositorio entero, corría como root y arrancaba
# `server/index.js` en lugar del entrypoint instrumentado `server/start.js`.
#
# El último punto era el más insidioso: docker-compose sobrescribía el comando y
# sí usaba `server/start.js`, así que la imagen por sí sola y la imagen dentro de
# Compose no tenían el mismo comportamiento. Quien desplegara la imagen tal cual
# perdía telemetría, apagado ordenado y readiness.

# --- Dependencias completas, sólo para construir --------------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

# --- Dependencias de producción, sin herramientas de build ----------------
FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- Runtime ---------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
WORKDIR /app

RUN groupadd --system flash \
 && useradd --system --gid flash --home-dir /app --shell /usr/sbin/nologin flash

COPY --chown=flash:flash package*.json ./
COPY --from=prod-deps --chown=flash:flash /app/node_modules ./node_modules
COPY --from=build --chown=flash:flash /app/dist ./dist
COPY --from=build --chown=flash:flash /app/server ./server
COPY --from=build --chown=flash:flash /app/database ./database
COPY --from=build --chown=flash:flash /app/scripts ./scripts

# El fallback SQLite crea este directorio de forma perezosa. Se declara acá con
# el dueño correcto para que un volumen nuevo herede la propiedad: si no, Docker
# lo monta como root y el proceso no privilegiado no puede escribir.
RUN mkdir -p /app/server/data && chown flash:flash /app/server/data

USER flash

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

# El mismo entrypoint que usa Compose. Instrumenta telemetría, readiness y
# apagado ordenado; `server/index.js` a secas no lo hace.
CMD ["node", "server/start.js"]
