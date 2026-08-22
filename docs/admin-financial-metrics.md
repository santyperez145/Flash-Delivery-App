# Métricas financieras administrativas

El dashboard administrativo consulta PostgreSQL y no proyecta un take rate fijo sobre los jobs. Los valores disponibles son pagos procesados, captura neta, refunds confirmados, revenue posteado, saldo por pagar a comercios y payouts pendientes.

El revenue de plataforma se calcula desde la cuenta ledger `platform/revenue`. Los settlements de comida y movilidad escriben asientos balanceados e idempotentes. En movilidad, una captura Wallet se debita de `cash_clearing` y se acredita entre Wallet del conductor y revenue de plataforma.

Burn mensual, objetivo de ronda, runway y margen de contribución se retornan como `null` porque todavía no existe un dominio contable de gastos. La interfaz los identifica como “sin configurar”. No deben inferirse con porcentajes fijos.

`revenueCoverage` documenta la cobertura del ledger. Hasta completar conciliación de todos los métodos externos, el dashboard no debe interpretarse como estado contable fiscal.
