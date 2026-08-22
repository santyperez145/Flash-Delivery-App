# API error budget

Confirmar alcance por estado y ruta normalizada; correlacionar `X-Request-Id` con la traza OTLP. Si la alerta es `page`, congelar despliegues y revertir sólo con correlación comprobada. Revisar `/api/ready`, pool y proveedores. Registrar impacto, causa, mitigación y prevención; cerrar únicamente cuando ambas ventanas recuperen el SLO.
