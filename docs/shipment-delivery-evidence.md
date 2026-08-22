# Evidencia real de entrega de envíos

La entrega no se completa con un cambio de estado manual. En `delivering`, el repartidor asignado debe registrar una foto y luego validar el PIN de cuatro dígitos que conserva el cliente. Si el cliente eligió firma de recepción, la condición forma parte del token de cotización y también debe cumplirse.

## Persistencia y privacidad

- La migración `054_shipment_delivery_evidence.sql` guarda metadatos, SHA-256, momento de captura y una ubicación PostGIS opcional.
- JPEG, PNG y WebP se validan por sus bytes de firma; declarar un MIME distinto no alcanza.
- El archivo tiene un máximo de 1,5 MB y se cifra con AES-256-GCM antes de persistirse. Producción exige `DELIVERY_PROOF_ENCRYPTION_KEY` independiente.
- Cliente propietario, conductor asignado y operaciones autorizadas pueden leer la evidencia. El rol auditor sólo recibe metadatos e integridad, nunca `content_ciphertext`.
- Una evidencia posterior del mismo tipo reemplaza la anterior para evitar acumulación ilimitada antes de completar.
- Las migraciones `063_shipment_signature_proof.sql` y `064_signature_audit_privacy.sql` agregan firma requerida, identidad declarada, relación con el destinatario y consentimiento versionado. El auditor no puede leer el nombre ni el contenido.

## Cierre financiero

La verificación bloquea el PIN en PostgreSQL después de cinco errores. Sólo `foto + PIN correcto`, o `foto + firma + PIN correcto` cuando corresponde, cambia el job a `completed`, genera el evento y notificación, y habilita una única liquidación balanceada conductor/plataforma. Los reintentos no vuelven a acreditar ganancias.

La app del conductor usa la cámara nativa mediante `expo-image-picker`, adjunta GPS cuando está disponible y muestra explícitamente cuándo la foto cifrada está lista. Para entregas firmadas, un pad táctil genera un PNG local con `react-native-view-shot`; el archivo se envía junto con identidad declarada y consentimiento. Actividad del cliente informa el requisito persistido.

## Dependencias

`npm audit` del árbol Expo 57 reporta advisories transitivos del toolchain Metro/Expo. La corrección automática ofrecida baja versiones mayores incompatibles con el SDK actual, por lo que no se aplicó `--force`. Debe reevaluarse al publicar el siguiente parche compatible de Expo; el backend no procesa esos parsers y además limita tamaño y tipos del archivo recibido.
