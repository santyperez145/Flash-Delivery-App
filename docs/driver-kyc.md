# Legajo y KYC de conductores

La migración `047_driver_kyc.sql` agrega un workflow de compliance y versiones documentales para identidad, licencia, cédula del vehículo, seguro y antecedentes.

- Mobile selecciona PDF, JPEG o PNG de hasta 750 KB.
- La API valida MIME, base64, tamaño, vencimiento y calcula SHA-256.
- El contenido se cifra con AES-256-GCM usando `KYC_DOCUMENT_ENCRYPTION_KEY` antes de persistirse.
- El rol técnico de auditoría puede ver metadata y hash, pero no tiene privilegio sobre el ciphertext.
- Subir o reemplazar un documento deja el legajo `in_review` y desconecta al conductor.
- Un conductor no puede autoaprobarse; sólo administración revisa y debe explicar rechazos.
- La disponibilidad online exige compliance aprobado y ningún documento aprobado vencido.
- Las filas legacy se migran aprobadas para no interrumpir el entorno seed, con recertificación explícitamente registrada.

Desktop muestra estado, cantidad aprobada y documentos pendientes con acciones de aprobar/rechazar. El endpoint de contenido descifra sólo para el propietario o staff autorizado y audita cada visualización sin copiar el archivo.

`npm run test:driver-kyc` cubre cifrado, hashes, ownership, prohibición de autoaprobación, revisión de los cinco tipos, habilitación online y bloqueo por vencimiento.
