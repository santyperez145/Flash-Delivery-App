# Alta real de repartidores y conductores (FE-06)

Hasta FE-06 un conductor existía sólo si lo creaba una semilla: el único
`INSERT INTO drivers` estaba en `scripts/db-seed-orders.mjs`, y con «todo real, nada
falso» Flash no tenía quién repartiera. Uber, Uber Eats, PedidosYa y Rappi resuelven el
alta con una postulación y una revisión de documentos; Flash hace lo mismo.

## Cómo funciona

1. **Teléfono verificado.** Postularse lo exige (409 con
   `code=phone_verification_required`). La web lo pide en el mismo paso:
   `POST /api/me/phone-verification/request` acepta ahora `{ phone }` y lo guarda sin
   verificar antes de mandar el código, sin pasar por el perfil (que exige una dirección).
   Un teléfono ya verificado no se cambia por ahí.
2. **Postularse** (`POST /api/applications/driver`, cualquier cuenta con sesión): ciudad
   abierta, servicios (entregas, y viajes sólo con auto y asientos declarados) y el
   vehículo. Una bicicleta no lleva patente; moto y auto sí. En una transacción crea el
   conductor **desconectado**, su legajo en `pending`, el vehículo en revisión, el rol
   `driver` y `profile.driverId` (por donde la sesión reconoce a su conductor), y lo
   audita. Quien ya es conductor recibe 409 con su `driverId`; una patente repetida, 409
   sin dejar nada a medias.
3. **Los requisitos** dependen del vehículo, como en Uber Eats: en bicicleta, DNI y
   certificado de antecedentes; con moto o auto, además la licencia, la cédula y el
   seguro (`requiredTypesForKinds` en `server/compliance-repository.js`). Se suben con la
   ruta cifrada que ya existía (`POST /api/drivers/:id/documents`); en la web, las fotos se
   achican a 1280 px antes de subir y un PDF entra si pesa menos de 750 KB. La licencia y
   el seguro piden fecha de vencimiento vigente.
4. **La cola de operaciones** (`GET /api/admin/driver-applications?status&cursor`, admin y
   soporte): de a 25, el conductor más viejo primero. `pending` es tener un documento o un
   vehículo esperando revisión; `approved` y `rejected` salen del legajo. Cada fila trae
   los documentos vigentes (el más nuevo de cada tipo, sin contenido) y los vehículos: la
   revisión no hace un pedido por conductor. El documento se abre recién al pedirlo
   (`/api/driver-documents/:id/content`) y se muestra embebido.
5. **Revisar** (sólo admin, con las rutas que ya existían): cada documento y el vehículo
   se aprueban o se rechazan con motivo, que lee quien se postuló. Con todos los
   documentos aprobados el legajo queda aprobado.

**Conectarse sigue siendo lo que se cuida.** El rol `driver` abre la carga de
requisitos, no las ofertas: `assertDriverCanGoOnline` exige el legajo aprobado y
vigente y un vehículo aprobado, y ahora también que quien se aprobó en bicicleta y activa
una moto o un auto tenga la licencia, la cédula y el seguro aprobados.

**Lo que corrigió la revisión del PR:**

- **El código de un número no verifica otro.** Cambiar el teléfono (por la postulación o
  por el perfil) anula los códigos pendientes en la misma sentencia, y confirmar exige
  que el código sea del número que la cuenta tiene ahora. Antes, pedir un código para un
  número, cambiarlo por otro y confirmar con el primero dejaba verificado el segundo.
- **La cédula del vehículo pide vencimiento**, como ya exigía el servidor: sin eso nadie
  con moto o auto podía terminar el alta.
- **Un documento aprobado que venció** se devuelve como `expired`, y la pantalla no dice
  «Ya podés conectarte» mientras el servidor lo rechazaría.
- **Un vehículo rechazado se corrige** desde `/repartir` y vuelve a revisión.
- **Si las ciudades no cargan**, se dice y se reintenta: no es lo mismo que no haya
  ninguna abierta.
- **La cola** sigue al documento por su identificador (si se reemplaza con la vista
  abierta, no se aprueba uno mientras se mira otro) y al refrescar vuelve a leer todas las
  páginas cargadas.

## Pantallas

- **`/repartir`** (web, `src/partners/DriverApplication.tsx`): sin sesión, el ingreso
  dice «Repartí con Flash» y muestra los pasos; con sesión, el teléfono, el vehículo y
  después «Tus requisitos»: cada fila es su estado y su acción («Falta subir», «En
  revisión», «Aprobado · vence el…», «Rechazado: motivo») con «Subir» o «Reemplazar». Se
  actualiza sola cada 30 segundos mientras haya algo en revisión.
- **Altas → Repartidores** (`src/backoffice/AdminDriverApplications.tsx`): la cola, el
  legajo con el documento embebido, aprobar de un clic y rechazar con motivo frecuente
  editable. Cuando a un conductor no le queda nada para revisar, pasa solo al siguiente.
- **El ingreso** ofrece «¿Querés repartir? Postulate», junto a «¿Tenés un comercio?».

## Las puertas

- **`npm run test:driver-applications`** (en `ci-critical-flows`, contra PostgreSQL y la
  API). Con cuentas sintéticas que borra al terminar, recorre la postulación (sin sesión,
  sin teléfono, datos inválidos, repetida, patente repetida), lo que se pide según el
  vehículo, que no se pueda conectar antes, la cola con sus permisos y su orden, rechazar
  y reemplazar, aprobar y conectarse, y que en moto no salga sin sus papeles. Si falla,
  alguien puede quedar conectado sin revisión o un repartidor no puede sumarse.
- **`npm run test:driver-onboarding`** (en `ci-fast`). Vigila que las pantallas sigan
  cableadas a eso: la ruta y el ingreso, el teléfono antes que todo, la bici sin patente,
  los requisitos con su motivo, la cola de un solo pedido y la decisión con motivo. Se
  falsificó con 33 mutaciones.

## Lo que falta

- **La app nativa** todavía no tiene la postulación: quien se registra desde el celular
  usa la web. La app ya muestra y carga el legajo de un conductor existente, y ahora
  permite declarar una bici sin patente.
- **Aviso al decidir:** la persona ve el resultado al volver a `/repartir` o en los 30
  segundos siguientes, pero todavía no recibe una notificación como la del alta de
  comercios.
- **Antecedentes contra el registro oficial:** el certificado se revisa a mano. Validarlo
  contra el Registro Nacional de Reincidencia o un proveedor de verificación es un
  tercero (como la verificación de identidad de Uber con Checkr).
