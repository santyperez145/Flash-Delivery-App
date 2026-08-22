# Expansión por ciudad

La ciudad es un límite operacional, no un filtro visual. `cities` conserva moneda, zona horaria IANA, centro, polígono PostGIS, estado de lanzamiento y servicios habilitados. `users`, `merchants`, `drivers`, `jobs` y `service_zones` requieren `city_id` e índices específicos.

`GET /api/cities` sólo publica ciudades `beta` o `active`; no entrega el polígono interno. `GET /api/zones?city=buenos-aires` rechaza slugs inválidos y ciudades todavía no habilitadas. Buenos Aires es la única ciudad beta y movilidad pública permanece fuera de sus servicios habilitados.

Antes de habilitar otra ciudad deben existir: aislamiento RLS por ciudad, supply mínimo verificado, comercios y zonas operables, pricing aprobado, soporte local, dashboards/SLO, PSP y obligaciones regulatorias aplicables. La prueba `test:city-isolation` verifica la integridad inicial contra PostgreSQL y el contrato HTTP.
