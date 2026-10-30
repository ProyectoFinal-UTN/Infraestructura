import { expect } from "@playwright/test";
import {
  asociarProveedorViaApi,
  crearProductoViaApi,
  crearProveedorViaApi,
  leerUbicaciones,
  registrarMovimientoViaApi,
  ubicacionPorNombre,
} from "./datos.js";

/**
 * Andamiaje de las alertas de reposicion (HU-17).
 *
 * Las alertas no se crean: se PROVOCAN. No hay endpoint que las de de alta y no
 * se insertan filas a mano — se llega al estado que el backend evalua y el
 * backend decide. Hay exactamente dos disparadores, y los dos se usan aca:
 *
 * 1. Un movimiento (HU-13) que mueva el stock, que es el recorrido de verdad.
 * 2. `PUT /api/productos/:id/umbral` (HU-16), que mueve el OTRO lado de la
 *    comparacion. Sirve para los escenarios en los que el stock no tiene que
 *    cambiar: con un movimiento habria que ensuciar el saldo para llegar al
 *    mismo lugar, y entonces el test ya no mide lo que dice.
 *
 * La regla que hay que tener presente al armar cualquier escenario, porque es
 * contraintuitiva y es facil escribir un test que la contradiga sin notarlo: el
 * backend evalua `stock <= umbral`, asi que un producto JUSTO en el minimo
 * alerta igual —alcanzar el umbral ya es estar en falta—, mientras que
 * `umbralMinimo = 0` significa «sin umbral» y no alerta NUNCA, aunque
 * `0 <= 0` sea verdadero.
 *
 * SOBRE LAS FECHAS: `generadaEn` lo pone el backend y no se puede fijar, igual
 * que `movimiento.fecha` (ver la nota de `comprasProveedor.js`). Pero aca no
 * molesta como en HU-21: el contrato de `GET /api/alertas` NO tiene filtro por
 * fecha —el query es solo `pagina` y `limite`—, asi que no hay ningun periodo
 * que calzar. Lo unico que se evita es derivar un dia con `new Date()` en Node:
 * sobre `alerta-generada-en` se afirma presencia, nunca un texto formateado.
 */

/**
 * Le fija el umbral a un producto por la API (HU-16).
 *
 * El PUT estaba escrito a mano adentro de `tests/api/umbrales.spec.js` y de
 * `tests/e2e/umbrales.spec.js`, donde el endpoint ES el sujeto de la prueba.
 * Aca es andamiaje y se necesita por tercera vez, que es el mismo criterio por
 * el que `crearOtroComercio` termino en `equipo.js`.
 *
 * `umbralMinimo` va como numero: el backend chequea el tipo y rechaza el string
 * con un 400.
 */
export async function fijarUmbralViaApi(api, productoId, umbralMinimo) {
  const respuesta = await api.put(`/api/productos/${productoId}/umbral`, {
    data: { umbralMinimo },
  });

  expect(
    respuesta.status(),
    `No se pudo fijar el umbral de ${productoId} en ${umbralMinimo}: ` +
      (await respuesta.text()),
  ).toBe(200);

  return respuesta.json();
}

/** `GET /api/alertas` crudo, sin afirmar nada. */
export function pedirAlertas(api, query = "") {
  return api.get(`/api/alertas${query}`);
}

/** Las alertas como andamiaje: exige el 200 y devuelve el cuerpo entero. */
export async function leerAlertasViaApi(api, query = "") {
  const respuesta = await pedirAlertas(api, query);

  expect(
    respuesta.status(),
    `No se pudieron leer las alertas: ${await respuesta.text()}`,
  ).toBe(200);

  return respuesta.json();
}

/** Una venta: la salida mas barata, porque es la unica que no pide motivo. */
export function venderViaApi(api, { productoId, cantidad, ubicacionId }) {
  return registrarMovimientoViaApi(api, {
    productoId,
    tipo: "venta",
    cantidad,
    ...(ubicacionId ? { ubicacionId } : {}),
  });
}

/** Una compra: la entrada que repone y resuelve la alerta. */
export function comprarViaApi(api, { productoId, cantidad, ubicacionId }) {
  return registrarMovimientoViaApi(api, {
    productoId,
    tipo: "compra",
    cantidad,
    ...(ubicacionId ? { ubicacionId } : {}),
  });
}

/**
 * Un producto con proveedor, umbral y stock, listo para cruzar el umbral.
 *
 * El escenario base de casi todos los tests. Devuelve tambien la ubicacion
 * «Principal» ya resuelta: el alta del primer producto la crea sola, y con una
 * sola ubicacion el movimiento no necesita `ubicacionId` — pero el test que
 * reparte el stock en dos si lo necesita, y pedirla de nuevo seria otro viaje a
 * Neon.
 *
 * `stockActual` y `umbralMinimo` viajan como strings porque asi los toma
 * `crearProductoViaApi`, que replica lo que entrega un `<input type="number">`.
 */
export async function escenarioDeAlerta(
  api,
  { umbral = 5, stockInicial = 20, conProveedor = true, nombre = "Fideos" } = {},
) {
  const producto = await crearProductoViaApi(api, {
    nombre: `${nombre} HU17 ${Date.now() % 100000}`,
    umbralMinimo: String(umbral),
    stockActual: String(stockInicial),
  });

  const proveedor = conProveedor ? await crearProveedorViaApi(api) : null;

  if (proveedor) {
    await asociarProveedorViaApi(api, producto.id, proveedor.id);
  }

  const principal = ubicacionPorNombre(await leerUbicaciones(api), "Principal");

  return { producto, proveedor, principal, umbral, stockInicial };
}
