import { expect } from "@playwright/test";

/**
 * Generadores de datos y andamiaje por API, compartidos por las dos suites.
 *
 * Todo lo de aca arma el escenario del test o lee lo que la UI no muestra;
 * nada de esto es el sujeto de una prueba. La API en si ya la cubren
 * Backend/tests/*.test.js con supertest, mas rapido y con acceso a la base.
 *
 * Los campos de producto viajan como strings porque asi se cargan en el
 * formulario (un `<input type="number">` entrega string). `crearProductoViaApi`
 * los convierte a numeros antes de postear: el backend chequea
 * `typeof valor === "number"` y rechaza los strings con un 400.
 */

let contador = 0;

/**
 * Codigo de barras unico. El indice unique del backend es
 * `(comercio_id, codigo_barras)` entre productos activos, y cada worker tiene
 * su propio comercio, pero igual se generan distintos para que un test pueda
 * crear varios productos sin chocar.
 */
export function codigoBarras() {
  contador += 1;
  return `7${`${Date.now()}${contador}`.slice(-12)}`;
}

/** Un producto valido, con nombre unico para poder ubicarlo en el listado. */
export function productoValido(overrides = {}) {
  const codigo = overrides.codigoBarras ?? codigoBarras();

  return {
    codigoBarras: codigo,
    nombre: `Coca-Cola 500ml ${codigo.slice(-5)}`,
    categoria: "Bebidas",
    unidadMedida: "unidad",
    umbralMinimo: "5",
    stockActual: "20",
    ...overrides,
  };
}

/**
 * Da de alta un producto por la API, sin pasar por la UI.
 *
 * Es andamiaje: los tests de edicion y de baja necesitan un producto que ya
 * exista, y hacerlos depender del test de alta los encadenaria. La API se usa
 * para armar el escenario, nunca como sujeto del test — eso ya lo cubre
 * Backend/tests/productos.test.js.
 */
export async function crearProductoViaApi(api, overrides = {}) {
  const campos = productoValido(overrides);

  const respuesta = await api.post("/api/productos", {
    data: {
      codigoBarras: campos.codigoBarras,
      nombre: campos.nombre,
      categoria: campos.categoria,
      unidadMedida: campos.unidadMedida,
      umbralMinimo: Number(campos.umbralMinimo),
      stockActual: Number(campos.stockActual),
    },
  });

  expect(
    respuesta.status(),
    `No se pudo precargar el producto: ${await respuesta.text()}`,
  ).toBe(201);

  // Se devuelven los campos como los espera el formulario (strings) mas el
  // `id` que asigno el backend.
  return { ...campos, id: (await respuesta.json()).id };
}

/**
 * Crea una ubicacion de stock (HU-8) por la API.
 *
 * El alta del primer producto ya crea una "Principal" sola, asi que esto se usa
 * para llegar al escenario de *varias* ubicaciones, que es el que hace visible
 * el selector del formulario de movimientos.
 */
export async function crearUbicacionViaApi(api, nombre) {
  const respuesta = await api.post("/api/ubicaciones", { data: { nombre } });

  expect(
    respuesta.status(),
    `No se pudo crear la ubicación «${nombre}»: ${await respuesta.text()}`,
  ).toBe(201);

  return respuesta.json();
}

/**
 * Borra una ubicacion (HU-8) por la API.
 *
 * Lo usa el unico test que necesita un comercio *sin* ninguna ubicacion, que
 * es un estado al que no se llega de otra forma: el alta de un producto crea
 * la "Principal" sola. Solo funciona sobre una ubicacion sin movimientos —
 * `movimiento.ubicacion_id` es `onDelete: "restrict"` y el backend lo traduce
 * a un 409—, asi que el producto que la deja libre tiene que haberse creado
 * con stock inicial 0.
 */
export async function eliminarUbicacionViaApi(api, ubicacionId) {
  const respuesta = await api.delete(`/api/ubicaciones/${ubicacionId}`);

  expect(
    respuesta.status(),
    `No se pudo eliminar la ubicación ${ubicacionId}: ${await respuesta.text()}`,
  ).toBe(204);
}

/** Las ubicaciones del comercio, para chequear precondiciones de un test. */
export async function leerUbicaciones(api) {
  const respuesta = await api.get("/api/ubicaciones");

  expect(
    respuesta.status(),
    `No se pudieron leer las ubicaciones: ${await respuesta.text()}`,
  ).toBe(200);

  return respuesta.json();
}

/**
 * Una ubicacion del comercio por su nombre, para tener su `id`.
 *
 * Hace falta porque los `<select>` de ubicacion se eligen por `value` —que es el
 * id— y no por la etiqueta visible: en la pantalla de transferencia la etiqueta
 * lleva el saldo pegado («Principal (10 unidades)») y cambia cuando vuelve la
 * consulta de stock, asi que elegir por texto es apuntar a un blanco movil.
 *
 * Se falla en vez de devolver `undefined` para que el test caiga donde esta el
 * problema —la ubicacion no se creo— y no mas adelante con un `selectOption`
 * recibiendo `undefined`, que es un error mucho mas dificil de leer.
 */
export function ubicacionPorNombre(ubicaciones, nombre) {
  const encontrada = ubicaciones.find((una) => una.nombre === nombre);

  expect(
    encontrada,
    `No existe la ubicación «${nombre}» en el comercio. Hay: ` +
      ubicaciones.map((una) => una.nombre).join(", "),
  ).toBeTruthy();

  return encontrada;
}

/**
 * Postea un movimiento y devuelve la respuesta cruda, sin afirmar nada.
 *
 * Es para los tests en los que el codigo de estado *es* lo que se prueba (el
 * 409 por stock insuficiente, la carrera de dos salidas simultaneas). Cuando el
 * movimiento es solo andamiaje, se usa `registrarMovimientoViaApi`.
 *
 * `cantidad` va siempre en positivo: el signo lo pone el backend segun el tipo,
 * y en un ajuste segun el `sentido`.
 */
export function enviarMovimiento(api, datos) {
  return api.post("/api/movimientos", { data: datos });
}

/**
 * Postea una transferencia y devuelve la respuesta cruda (HU-12).
 *
 * Gemelo de `enviarMovimiento`, y por el mismo motivo: es para los tests en los
 * que el codigo de estado *es* lo que se prueba —las dos transferencias
 * simultaneas en sentidos opuestos, que tienen que terminar sin 500—.
 *
 * `cantidad` va en positivo y como numero JSON: el backend chequea
 * `typeof cantidad === "number"` y un string da 400. El signo lo pone el backend,
 * que arma la salida en negativo sobre el origen y la entrada en positivo sobre
 * el destino.
 */
export function enviarTransferencia(api, datos) {
  return api.post("/api/transferencias", { data: datos });
}

/** Registra un movimiento como andamiaje: exige el 201 y devuelve el cuerpo. */
export async function registrarMovimientoViaApi(api, datos) {
  const respuesta = await enviarMovimiento(api, datos);

  expect(
    respuesta.status(),
    `No se pudo registrar el movimiento: ${await respuesta.text()}`,
  ).toBe(201);

  return respuesta.json();
}

/**
 * El stock del producto, discriminado por ubicacion y con el total (HU-11).
 *
 * Es el unico lugar donde se puede leer el saldo: el listado de productos no lo
 * muestra y `GET /api/movimientos` no existe todavia (HU-14). De aca sale la
 * verificacion del criterio "el stock se actualiza".
 */
export async function leerStock(api, productoId) {
  const respuesta = await api.get(`/api/productos/${productoId}`);

  expect(
    respuesta.status(),
    `No se pudo leer el producto ${productoId}: ${await respuesta.text()}`,
  ).toBe(200);

  return (await respuesta.json()).stock;
}

/**
 * El saldo en una ubicacion concreta.
 *
 * Con mas de una ubicacion hay que mirar aca y no `stock.total`: el total suma
 * todas, asi que un movimiento aplicado al estante equivocado daria el mismo
 * numero y el test pasaria en verde estando mal.
 *
 * HU-11 incluye las ubicaciones sin movimientos con cantidad 0, asi que no
 * encontrar la fila significa que esa ubicacion no es del comercio, no que
 * este vacia — por eso se falla en vez de devolver 0.
 */
export function stockEn(detalle, nombreUbicacion) {
  const fila = detalle.porUbicacion.find(
    (item) => item.ubicacionNombre === nombreUbicacion,
  );

  expect(
    fila,
    `«${nombreUbicacion}» no figura en el stock del producto. Hay: ` +
      detalle.porUbicacion.map((item) => item.ubicacionNombre).join(", "),
  ).toBeTruthy();

  return fila.cantidad;
}

/**
 * Los movimientos de tipo `transferencia` de un producto (HU-12, via HU-14).
 *
 * De aca sale la verificacion del criterio "la transferencia queda registrada
 * como un par ligado": las dos patas comparten `transferenciaId`, una en
 * negativo sobre el origen y otra en positivo sobre el destino. Leerlo por la API
 * y no de la base alcanza porque el par *si* se ve por HTTP, a diferencia de lo
 * que mira `tests/api/soporte/base.js`.
 *
 * Dos cosas del contrato de `GET /api/movimientos` que sorprenden y que este
 * helper resuelve de una vez:
 *
 * - La respuesta no es un array pelado: es `{ movimientos, paginacion }`. Se
 *   devuelve solo `movimientos`, y se afirma que la pagina no se corto, porque el
 *   limite por defecto es 50 y un test que genere mas patas leeria de menos sin
 *   enterarse.
 * - Cada item **anida** la ubicacion en `ubicacion: { id, nombre }`; no hay
 *   `ubicacionId` ni `ubicacionNombre` planos. Ojo con reusar aserciones de la
 *   respuesta 201 del POST, que si los trae planos: son dos shapes distintos para
 *   el mismo concepto.
 *
 * El orden tampoco sirve para distinguir las patas: el historial ordena por
 * `fecha DESC, id DESC` y las dos comparten el instante, asi que el desempate es
 * por id. Se separan por el signo de `cantidad`, nunca por indice.
 */
export async function leerMovimientosDeTransferencia(api, productoId) {
  const respuesta = await api.get(
    `/api/movimientos?tipo=transferencia&productoId=${productoId}`,
  );

  expect(
    respuesta.status(),
    `No se pudo leer el historial de transferencias: ${await respuesta.text()}`,
  ).toBe(200);

  const { movimientos, paginacion } = await respuesta.json();

  expect(
    movimientos.length,
    `El historial se corto por paginacion (${paginacion.total} en total, ` +
      `limite ${paginacion.limite}). Pedir mas con el parametro «limite».`,
  ).toBe(paginacion.total);

  return movimientos;
}

/**
 * Las dos patas de una transferencia, separadas por el signo de la cantidad.
 *
 * Se afirma que son exactamente dos y que comparten `transferenciaId` antes de
 * devolverlas: si el endpoint dejara una pata sola —lo que un doble envio o un
 * rollback a medias produciria— el test tiene que caer aca, con el conteo a la
 * vista, y no mas adelante en una asercion sobre un saldo.
 */
export function parDeTransferencia(movimientos) {
  expect(
    movimientos.map((uno) => uno.cantidad),
    "una transferencia tiene que dejar exactamente dos movimientos",
  ).toHaveLength(2);

  const salida = movimientos.find((uno) => uno.cantidad < 0);
  const entrada = movimientos.find((uno) => uno.cantidad > 0);

  expect(salida, "falta la pata negativa (la salida del origen)").toBeTruthy();
  expect(entrada, "falta la pata positiva (la entrada al destino)").toBeTruthy();

  expect(
    salida.transferenciaId,
    "las dos patas tienen que compartir el mismo transferenciaId",
  ).toBe(entrada.transferenciaId);

  expect(salida.transferenciaId, "el transferenciaId no puede ser nulo").toBeTruthy();

  return { salida, entrada };
}
