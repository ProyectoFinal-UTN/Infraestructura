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
