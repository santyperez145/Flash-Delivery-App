-- Los registros de dinero y de eventos pasan a ser append-only (ticket DAT-001).
--
-- `test:runtime-write-scope` midio 114 permisos de mas: pares (tabla, operacion)
-- que `flash_runtime` tiene y ningun camino usa. Este es el primer lote, y no se
-- eligio por ser el mas grande sino por ser el que mas cambia si algo sale mal.
--
-- Todas estas tablas comparten una forma: **se escriben una vez y no se tocan
-- mas**. Un asiento contable posteado, un evento de un pedido, una escalada de
-- soporte. Que el runtime pueda modificarlos o borrarlos no habilita ninguna
-- funcion del producto; sólo agranda lo que un bug de handler o un token robado
-- pueden hacer.
--
-- Es la contraparte del trigger de balance. El trigger impide **escribir** una
-- transaccion torcida; esto impide **enderezar** una que ya cuadra, o hacerla
-- desaparecer. Sin lo segundo, lo primero se puede rodear en dos sentencias.
--
-- La verificacion no es teorica: en CI la API se conecta como `flash_runtime`,
-- asi que si algun camino necesitaba uno de estos permisos, una suite se pone
-- roja. Es la razon de acotar por lotes y no de una vez.

-- El libro contable. Un asiento posteado no se corrige: se compensa con otro
-- asiento, que es como funciona la partida doble.
REVOKE UPDATE, DELETE ON ledger_entries FROM flash_runtime;
REVOKE UPDATE, DELETE ON ledger_transactions FROM flash_runtime;

-- Las cuentas se crean y se actualizan —`systemAccount` es un upsert— pero no se
-- borran nunca desde el runtime.
REVOKE DELETE ON ledger_accounts FROM flash_runtime;

-- La vista agregada sobre el ledger. No la escribe nadie, y una vista con
-- escritura sobre una tabla protegida es una puerta lateral: no lo es acá porque
-- agrupa y no es auto-actualizable, pero eso depende de su definicion y la
-- definicion puede cambiar.
REVOKE INSERT, UPDATE, DELETE ON ledger_transaction_balances FROM flash_runtime;

-- Registros de eventos. Se agregan; no se editan ni se borran.
REVOKE UPDATE, DELETE ON job_events FROM flash_runtime;
REVOKE UPDATE, DELETE ON support_escalation_events FROM flash_runtime;
REVOKE UPDATE ON product_events FROM flash_runtime;
REVOKE UPDATE ON realtime_events FROM flash_runtime;

-- Cobros y reintegros. Se actualizan de estado, pero borrarlos haria desaparecer
-- el rastro de una operacion de dinero.
REVOKE DELETE ON payment_intents FROM flash_runtime;
REVOKE DELETE ON refunds FROM flash_runtime;
