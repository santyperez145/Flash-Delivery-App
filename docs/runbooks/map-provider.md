# Map provider degradation

Revisar `provider`, `operation` y `outcome` sin agregar coordenadas como labels. Confirmar si se sirve caché stale, el presupuesto diario y el estado del proveedor. No cerrar el circuito manualmente sin una prueba exitosa. Para cotizaciones nuevas, conservar el fallo explícito si no existe una ruta cacheada confiable; nunca inventar distancia o ETA.
