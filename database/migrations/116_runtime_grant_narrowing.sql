-- El runtime deja de poder escribir donde nunca escribe (ticket DAT-001).
--
-- La migración 010 le dio a `flash_runtime` `SELECT, INSERT, UPDATE, DELETE ON
-- ALL TABLES` y, peor, una regla de privilegios por omisión que repite ese
-- permiso sobre **toda tabla futura**. Esa segunda parte es la que dejó
-- alcanzable un almacén de credenciales muerto durante meses: nadie tuvo que
-- otorgar nada, la tabla nació con DML.
--
-- Acá se hacen dos cosas distintas.
--
-- **Primera: revocar escritura donde el código nunca escribe.** El inventario
-- se hizo sobre `server/**`, buscando `INSERT INTO`, `UPDATE` y `DELETE FROM`
-- por tabla. De 104 tablas, el runtime sólo lee ocho, y todas son datos de
-- referencia: alérgenos, ciudades, etiquetas dietarias, campañas de referidos,
-- planes de protección, políticas de SLA y de aptitud de zona.
--
-- El inventario mecánico se corrigió a mano en un punto que importa: **los
-- triggers escriben tablas que el código nunca nombra.** `drivers` tiene
-- disparadores que insertan en `driver_availability_sessions` y
-- `driver_job_sessions` cuando alguien se pone en línea, y esas funciones no
-- son `SECURITY DEFINER`, así que corren con los permisos de quien las dispara.
-- Revocarle la escritura al runtime habría roto que un conductor se conecte,
-- con un error de permisos en un trigger, que es de los peores de diagnosticar.
-- Las tres tablas escritas por función quedan fuera de la revocación.
--
-- **Segunda: cortar la herencia.** Se retira la regla de privilegios por
-- omisión. No revoca nada existente —el permiso se materializa al crear la
-- tabla, y las creadas hasta acá conservan el suyo—, pero a partir de ahora una
-- tabla nueva **nace sin acceso para el runtime** y hay que otorgárselo a mano
-- en la misma migración que la crea.
--
-- Eso cambia el modo de fallar, y a mejor: antes una tabla sin revisar quedaba
-- silenciosamente escribible; ahora una tabla sin grant explícito falla fuerte
-- y temprano, en CI, con «permission denied for table». Un error ruidoso en
-- desarrollo vale más que un permiso de más en producción.

-- La guarda de rol es la misma que usa la 010: el esquema tiene que poder
-- aplicarse en un entorno donde los roles separados no existan.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    REVOKE INSERT, UPDATE, DELETE ON
      allergens,
      cities,
      dietary_labels,
      payment_customers,
      referral_campaigns,
      shipment_protection_plans,
      support_sla_policies,
      zone_readiness_policies
    FROM flash_runtime;

    ALTER DEFAULT PRIVILEGES FOR ROLE flash_app IN SCHEMA public
      REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM flash_runtime;
  END IF;
END $$;
