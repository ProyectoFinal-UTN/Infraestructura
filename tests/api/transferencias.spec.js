import { expect, test } from "./soporte/base.js";
import {
  crearProductoViaApi,
  crearUbicacionViaApi,
  enviarTransferencia,
  leerStock,
  leerUbicaciones,
  registrarMovimientoViaApi,
  stockEn,
  ubicacionPorNombre,
} from "../soporte/datos.js";

/**
 * HU-12 (SCRUM-24), criterio de consistencia bajo concurrencia. Subtarea de
 * testing SCRUM-103.
 *
 * Va contra la API y no por la interfaz por lo mismo que
 * `atomicidad-movimientos.spec.js`: dos transferencias que se cruzan no se pueden
 * disparar desde un navegador de forma confiable, y lo que hay que observar —que
 * el saldo cacheado siga siendo la suma del libro— no se ve en ninguna pantalla.
 * Este archivo corre en el proyecto `api`, sin browser.
 *
 * ALCANCE, escrito para que nadie lo lea de más:
 *
 * `Backend/tests/transferencias.test.js` ya prueba esto con supertest en proceso
 * ("dos transferencias en sentidos opuestos no terminan en un 500 por deadlock").
 * Lo que agrega este archivo es que la propiedad sobrevive al stack real —Nginx,
 * el contenedor, el pool de conexiones a Neon—, que es la condición que pide la
 * promoción `dev → main`. No se re-testea la lógica: se verifica que aguanta el
 * viaje.
 *
 * ES PROBABILÍSTICO, y conviene saberlo antes de confiar en un verde:
 *
 * `Promise.all` no garantiza que las dos transacciones se crucen. Pueden
 * serializarse limpio y el test pasa sin haber ejercitado el cruce; no hay forma
 * de forzarlo por HTTP, y meter esperas para fingir determinismo daría un test más
 * lento y no más sólido. O sea: este test puede fallar si hay un problema, pero no
 * puede demostrar que no lo hay.
 *
 * Lo que sostiene el caso del lado del backend es `bloquearFilasDeStock`, que toma
 * los `FOR UPDATE` de las dos filas de una vez y antes de cualquier escritura, con
 * `ORDER BY stock.ubicacion_id ASC`. Ese orden es el mismo para los dos sentidos,
 * así que A→B y B→A piden los bloqueos en el mismo orden global y no se cruzan.
 * **No es una garantía documentada de Postgres**: el orden en que se bloquea
 * depende del orden en que el plan devuelve las filas, y el propio código del
 * backend lo advierte. El aislamiento, además, es el default (READ COMMITTED): no
 * hay `isolationLevel` en ninguna parte del Backend, y la corrección descansa en
 * ese `FOR UPDATE` y en la suma hecha en SQL, no en el nivel de aislamiento.
 *
 * Si este test cae con un 500, no es un test frágil: es el hallazgo. El lugar a
 * mirar es ese `ORDER BY`, y el síntoma a buscar en los logs del backend es un
 * `40P01`.
 *
 * El producto se crea con `stockActual: 0` a propósito, igual que en
 * `atomicidad-movimientos.spec.js`: un alta con stock inicial mayor a cero genera
 * su propio movimiento de respaldo y los conteos arrancarían en uno por un motivo
 * ajeno a lo que se prueba.
 */

const DEPOSITO = "Depósito";
const PRINCIPAL = "Principal";

test.describe("HU-12 — Transferencias simultáneas", () => {
  test("dos transferencias en sentidos opuestos no terminan en un 500", async ({
    api,
    base,
  }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "0" });
    const deposito = await crearUbicacionViaApi(api, DEPOSITO);
    const principal = ubicacionPorNombre(await leerUbicaciones(api), PRINCIPAL);

    // Stock en las dos puntas, para que ninguna de las dos transferencias pueda
    // fallar por falta de mercadería: lo único que puede hacerlas caer es que se
    // pisen entre ellas, que es justo lo que se quiere observar.
    for (const ubicacion of [principal, deposito]) {
      await registrarMovimientoViaApi(api, {
        productoId: producto.id,
        ubicacionId: ubicacion.id,
        tipo: "compra",
        cantidad: 20,
      });
    }

    const [ida, vuelta] = await Promise.all([
      enviarTransferencia(api, {
        productoId: producto.id,
        ubicacionOrigenId: principal.id,
        ubicacionDestinoId: deposito.id,
        cantidad: 5,
      }),
      enviarTransferencia(api, {
        productoId: producto.id,
        ubicacionOrigenId: deposito.id,
        ubicacionDestinoId: principal.id,
        cantidad: 5,
      }),
    ]);

    // Las dos tienen que pasar: hay 20 en cada punta y cada una saca 5, así que no
    // compiten por las mismas unidades. Un 500 acá es el deadlock; un 409 sería un
    // guarda leyendo un saldo que otra transacción dejó a medias.
    expect(
      [ida.status(), vuelta.status()],
      `ida: ${await ida.text()} · vuelta: ${await vuelta.text()}`,
    ).toEqual([201, 201]);

    // Cuatro movimientos de transferencia (dos patas por operación) que se
    // compensan: cada ubicación sale y entra 5, así que los saldos vuelven a 20.
    const detalle = await leerStock(api, producto.id);
    expect(stockEn(detalle, PRINCIPAL)).toBe(20);
    expect(stockEn(detalle, DEPOSITO)).toBe(20);
    expect(detalle.total, "el total se conserva").toBe(40);

    // El invariante del modelo híbrido, contra la base: el saldo cacheado que lee
    // la app y la suma del libro append-only tienen que dar lo mismo en cada
    // ubicación. Si una de las cuatro patas se hubiera grabado sin actualizar su
    // saldo —o al revés—, los números de arriba podrían seguir cerrando y esto no.
    expect(await base.saldosDe(producto.id)).toEqual(
      await base.sumasDelLibro(producto.id),
    );
  });
});
