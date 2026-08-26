// Centavos a pesos, en un solo lugar (ticket ARC-001).
//
// Estaba definida tres veces —`commerce-repository.js`, `mobility-repository.js`
// y `receipt-repository.js`— con el mismo cuerpo y distinto nombre de
// parámetro. Partir `commerce-repository.js` habría creado la cuarta, que es
// cuando una de ellas empieza a diferir sin que nadie lo note.
//
// La base guarda importes en centavos enteros a propósito: `numeric` con
// decimales invita a que una suma de partes no dé el total. La conversión a
// pesos existe sólo para el borde HTTP, y por eso vive acá y no en cada
// repositorio.
//
// **La guarda `|| 0` no es cosmética y no es obviamente correcta.** Convierte
// una columna ausente en cero, es decir, en "no se cobró nada". Es lo que hacían
// las tres copias y se conserva para no cambiar comportamiento al unificarlas,
// pero hay 26 conversiones en línea repartidas por los repositorios que no la
// tienen, y ahí una columna ausente da `NaN`. Las dos respuestas son defendibles
// —cero miente, `NaN` se propaga— y ninguna de las dos se eligió: se escribieron
// distinto en momentos distintos. `test:money` fija el número y sólo lo deja
// bajar, para que la próxima vez que alguien toque una de esas conversiones
// tenga que decidir cuál de las dos quiere.
export const pesos = (cents) => Number(cents || 0) / 100;
