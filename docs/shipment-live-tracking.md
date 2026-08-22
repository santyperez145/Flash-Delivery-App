# Seguimiento visual de envíos

Actividad abre un panel dedicado para cada envío activo. No anima posiciones ficticias: consume origen/destino PostGIS del job, ruta vial de `/api/maps/route`, estado/timeline PostgreSQL y última ubicación persistida del conductor asignado.

## Mapa adaptable

El cliente calcula el nivel de zoom entre 8 y 15 a partir de todos los puntos visibles —origen, destino, geometría de ruta y conductor— y selecciona el mosaico OSM correspondiente. Esto mantiene rutas urbanas cortas y recorridos largos dentro del panel sin estirar coordenadas ni usar una imagen estática.

Si Routes no responde, el panel conserva el estado operativo y muestra un error explícito; no reemplaza distancia o ETA con un número inventado.

## Información operativa

- Progreso: solicitado, conductor asignado, retirando, retirado, en camino y entregado.
- Nivel SLA, categoría, peso, tarifa e instrucciones de manipulación.
- Conductor y vehículo cuando existe asignación.
- Estado de foto y firma cifradas mediante el endpoint autorizado de evidencia.
- Estado de logística inversa cuando existe una devolución.
- PIN obtenido bajo demanda por el propietario; el backend lo deniega después del cierre.

La tarjeta de Actividad es ahora interactiva y abre este seguimiento. El mismo encuadre adaptativo también se aplica al tracking de comida para reducir roturas en trayectos fuera del centro habitual.

## Verificación

La suite PostgreSQL cubre ownership de rutas, PIN y evidencia; `test:maps` verifica cache persistente, rutas y coordenadas inválidas. El cliente mobile debe superar TypeScript y el runtime web; la inspección de estados específicos requiere un envío activo de la cuenta autenticada.
