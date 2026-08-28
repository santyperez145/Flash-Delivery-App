-- Suspender un comercio, y que eso signifique algo acotado (ticket OPS-001).
--
-- `merchants.status` era `text NOT NULL DEFAULT 'active'` **sin restriccion**:
-- cualquier cadena entraba. Como las cuarenta y un consultas del producto
-- filtran por `status='active'`, un valor mal tipeado suspendia el comercio en
-- todas partes a la vez y sin decirlo. La restriccion cierra eso.
--
-- Y hasta ahora **nada podia escribir esa columna**: no habia ruta. Suspender un
-- comercio —el caso de las dos de la manana: intoxicacion, fraude, un local que
-- acepta y no cocina— exigia entrar a la base y correr un UPDATE a mano, que es
-- exactamente lo que el criterio «ningun incidente requiere SQL manual» prohibe.
--
-- **Suspender frena lo nuevo y no cancela lo que ya esta en curso.** Un pedido
-- que se esta cocinando se termina de cocinar: cancelarlo en masa castiga a
-- clientes que no hicieron nada y deja comida hecha sin destino. Lo que la
-- suspension corta es que entre uno mas.
ALTER TABLE merchants
  ADD CONSTRAINT merchants_status_known CHECK (status IN ('active', 'suspended'));

CREATE INDEX merchants_suspended_idx ON merchants(status) WHERE status <> 'active';

COMMENT ON COLUMN merchants.status IS
  'active o suspended. Suspendido no aparece en catalogo, busqueda ni cotizacion, y no admite pedidos nuevos; los pedidos en curso siguen su ciclo hasta completarse.';
