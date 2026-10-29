import { expect } from "@playwright/test";
import {
  crearProductoViaApi,
  crearProveedorViaApi,
  registrarMovimientoViaApi,
} from "./datos.js";

/**
 * Andamiaje del historial de compras por proveedor (HU-21).
 *
 * Las compras se crean por el FLUJO REAL de HU-13 —`POST /api/movimientos` con
 * `tipo: "compra"` y `proveedorId`— y no insertando filas en `movimiento`. Es la
 * diferencia entre probar el historial y probar una consulta SQL: una fila
 * puesta a mano puede ser imposible de producir por la aplicacion (sin stock,
 * con un proveedor de otro comercio) y entonces el test pasa sobre un escenario
 * que en la vida real no existe.
 *
 * ---------------------------------------------------------------------------
 * SOBRE LAS FECHAS: no se pueden fijar, y no es una omision.
 *
 * `movimiento.fecha` es `timestamp("fecha").defaultNow().notNull()`
 * (Backend/src/db/schema.js) y ni `registrarMovimiento` ni el POST aceptan una
 * `fecha`: toda compra registrada por el flujo real queda con el `now()` de la
 * base. O sea que "crear por el flujo real" y "con fechas fijas y explicitas"
 * se excluyen, y en este repo gana el flujo real.
 *
 * Lo determinista se consigue de dos maneras, y ninguna inventa una fecha:
 *
 * 1. Para el periodo que tiene que INCLUIR las compras, se usa el dia de la
 *    compra tal como lo devolvio el backend. Pero cuidado: el dia hay que
 *    calcularlo EN EL NAVEGADOR, porque es el navegador el que convierte el
 *    "AAAA-MM-DD" del filtro a un instante (ver `diaDe` en
 *    tests/e2e/soporte/historialCompras.js). Calcularlo con `new Date()` aca
 *    usaria la zona de Node, que `timezoneId` no toca.
 * 2. Para el periodo que tiene que DEJARLAS AFUERA se usa `PERIODO_SIN_COMPRAS`,
 *    que si es literal y fijo.
 */

/**
 * Un periodo cerrado del pasado, anterior a cualquier corrida posible.
 *
 * Fijo a proposito y no "hace un ano": con un rango relativo, el dia que alguien
 * corra la suite con el reloj movido el periodo podria empezar a incluir
 * compras, y el test del estado vacio pasaria a probar otra cosa sin que nadie
 * se enterara. Enero de 2026 es anterior al primer commit del proyecto, asi que
 * no hay forma de que una compra caiga adentro.
 */
export const PERIODO_SIN_COMPRAS = { desde: "2026-01-01", hasta: "2026-01-31" };

/**
 * Registra una compra por el flujo de HU-13 y devuelve el movimiento.
 *
 * `cantidad` va en positivo, como en todo `enviarMovimiento`: el signo lo pone
 * el backend. En una compra lo deja positivo —es una entrada—, a diferencia de
 * HU-14, donde el historial mezcla salidas y las muestra en negativo.
 */
export async function crearCompraViaApi(
  api,
  { productoId, proveedorId, cantidad, motivo },
) {
  const { movimiento } = await registrarMovimientoViaApi(api, {
    productoId,
    proveedorId,
    tipo: "compra",
    cantidad,
    ...(motivo ? { motivo } : {}),
  });

  expect(
    movimiento.cantidad,
    "una compra es una entrada: el backend la guarda en positivo",
  ).toBeGreaterThan(0);

  return movimiento;
}

/**
 * El escenario que comparten casi todos los tests: un proveedor con tres
 * compras sobre dos productos.
 *
 * Los numeros no son redondos ni iguales entre si a proposito. Si las tres
 * compras fueran de 10, un resumen que sumara mal —que contara la pagina en vez
 * del periodo, o que contara dos veces una fila— podria dar igual por
 * casualidad. Con 7, 3 y 12 el total (22) no se puede obtener por accidente
 * desde ningun subconjunto.
 */
export async function escenarioDeCompras(api) {
  const proveedor = await crearProveedorViaApi(api);

  const yerba = await crearProductoViaApi(api, {
    nombre: `Yerba HU21 ${Date.now() % 100000}`,
    stockActual: "0",
  });
  const harina = await crearProductoViaApi(api, {
    nombre: `Harina HU21 ${Date.now() % 100000}`,
    stockActual: "0",
  });

  // En orden, del mas viejo al mas nuevo: el historial los muestra al reves.
  const compras = [
    await crearCompraViaApi(api, {
      productoId: yerba.id,
      proveedorId: proveedor.id,
      cantidad: 7,
    }),
    await crearCompraViaApi(api, {
      productoId: harina.id,
      proveedorId: proveedor.id,
      cantidad: 3,
      motivo: "Reposición semanal",
    }),
    await crearCompraViaApi(api, {
      productoId: yerba.id,
      proveedorId: proveedor.id,
      cantidad: 12,
    }),
  ];

  return {
    proveedor,
    yerba,
    harina,
    compras,
    unidades: 22,
    // Del mas nuevo al mas viejo, que es el orden en el que los pinta la
    // pantalla.
    idsEnPantalla: [...compras].reverse().map((compra) => String(compra.id)),
  };
}

/** `GET /api/proveedores/:id/historial-compras` crudo, sin afirmar nada. */
export function pedirHistorial(api, proveedorId, query = "") {
  return api.get(`/api/proveedores/${proveedorId}/historial-compras${query}`);
}

/** El historial como andamiaje: exige el 200 y devuelve el cuerpo. */
export async function leerHistorialViaApi(api, proveedorId, query = "") {
  const respuesta = await pedirHistorial(api, proveedorId, query);

  expect(
    respuesta.status(),
    `No se pudo leer el historial de ${proveedorId}: ${await respuesta.text()}`,
  ).toBe(200);

  return respuesta.json();
}

/** Da de baja un proveedor (baja logica, HU-19). */
export async function darDeBajaProveedorViaApi(api, proveedorId) {
  const respuesta = await api.delete(`/api/proveedores/${proveedorId}`);

  expect(
    respuesta.status(),
    `No se pudo dar de baja al proveedor ${proveedorId}: ${await respuesta.text()}`,
  ).toBe(204);
}
