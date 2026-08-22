# Dietas y alérgenos de catálogo

La migración `059_catalog_dietary_allergens.sql` reemplaza etiquetas libres por catálogos normalizados y relaciones por producto. Las dietas disponibles son vegetariano, vegano, sin gluten, halal y kosher. Los nueve alérgenos cubren gluten, leche, huevo, maní, frutos secos, soja, pescado, crustáceos y sésamo.

Cada alérgeno declara explícitamente `contains` o `may_contain`; la ausencia de una declaración no se interpreta como producto seguro. Flash Negocios gestiona esta información mediante `PUT /api/restaurants/:restaurantId/menu/:itemId/dietary`, limitado al comercio propietario o administrador. La sustitución se ejecuta en una transacción, valida vocabularios e IDs únicos, registra auditoría y publica un evento en tiempo real.

Mobile muestra las dietas como identificadores positivos y los alérgenos dentro de una advertencia visible antes de elegir agregados. Estas declaraciones son informativas: una indicación de cocina no puede eliminar un alérgeno estructurado.

La suite PostgreSQL verifica ownership, vocabularios controlados, persistencia normalizada y lectura posterior. RLS permite al rol auditor inspeccionar postura sin modificar declaraciones.

## Preferencias del cliente

La migración `060_user_dietary_preferences.sql` agrega un perfil alimentario privado por usuario, dietas requeridas y alérgenos evitados. `GET` y `PUT /api/dietary-preferences` sólo operan sobre la identidad autenticada; no aceptan un ID de usuario aportado por el cliente.

En Cuenta, mobile permite editar las preferencias y activar el filtro de incompatibles. Un producto se considera compatible cuando declara todas las dietas seleccionadas y no declara ninguno de los alérgenos evitados. La ausencia de una declaración jamás se presenta como garantía de seguridad y la interfaz mantiene una advertencia para alergias severas y contaminación cruzada.

## Búsqueda de catálogo

La migración `061_catalog_search.sql` habilita `pg_trgm` e índices GIN parciales para nombres de comercios y texto de productos. `GET /api/catalog/search` realiza ranking difuso, sólo considera sucursales efectivamente abiertas e inventario disponible, aplica el perfil alimentario de la identidad autenticada y pagina con `limit`/`offset` acotados.

Mobile usa esta API con debounce, estados de carga, error, vacío y “ver más”. Los resultados indican los productos que produjeron la coincidencia y abren el comercio existente sin duplicar el catálogo en memoria.
