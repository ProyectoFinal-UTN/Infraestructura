import { expect, test } from "../soporte/fixtures.js";
import {
  crearProductoViaApi,
  crearUbicacionViaApi,
  leerMovimientosDeTransferencia,
  leerStock,
  leerUbicaciones,
  parDeTransferencia,
  registrarMovimientoViaApi,
  stockEn,
  ubicacionPorNombre,
} from "../soporte/datos.js";
import { DetalleProducto } from "./soporte/detalleProducto.js";
import { contarPosteosDeTransferencia } from "./soporte/red.js";
import {
  confirmacionEsperada,
  linkDesdeDetalle,
  linkDesdeInicio,
  Transferencias,
  UBICACION_POR_DEFECTO,
} from "./soporte/transferencias.js";

/**
 * E2E de HU-12 (SCRUM-24, RF2/RF4) — transferir stock del depósito al local o al
 * revés. Subtarea de testing SCRUM-103.
 *
 * Es la primera vez que esta pantalla corre contra el backend de verdad: los
 * tests del Frontend son unitarios con el service mockeado y los de Jest del
 * Backend van por supertest sin navegador, así que nadie había verificado que las
 * dos mitades se entiendan. Eso es lo que estos tests vienen a probar, y no la
 * lógica de ninguno de los dos lados por separado.
 *
 * Lo que deliberadamente NO está acá, y dónde sí está:
 *
 * - La atomicidad ante un fallo a mitad de camino y la carrera por las últimas
 *   unidades: `Backend/tests/transferencias.test.js`. Los dos guardas del backend
 *   corren antes del INSERT, así que por HTTP no hay forma de provocar un corte
 *   entre la salida y la entrada. El caso del máximo de stock lo deja observable
 *   de rebote, pero no es su sujeto.
 * - La validación del body campo por campo (cantidad como string o decimal,
 *   motivo de 255, origen igual al destino, ids en mayúsculas) y el aislamiento
 *   multi-tenant: `Backend/tests/transferencias.service.test.js` y
 *   `transferencias.test.js`, sobre la función pura y con supertest. Repetirlo por
 *   HTTP no agrega una capa, agrega minutos.
 * - El error de red, el 5xx, el 401, el 2xx sin cuerpo y el producto dado de baja
 *   con la pantalla abierta: unitarios del Frontend, donde el service se mockea.
 *   Un `route.abort()` acá probaría el mock de Playwright, no el stack.
 * - El 400 por origen igual al destino **no es alcanzable desde la interfaz** y
 *   queda sin cubrir de este lado a propósito: el `<select>` de destino excluye lo
 *   que esté elegido como origen, así que la UI no permite armar ese pedido.
 *   Forzarlo escribiendo un `value` inexistente probaría el `evaluate`, no la
 *   pantalla. El 400 lo cubre Jest y el filtro lo cubre el unitario del Frontend.
 * - El rol: un chequeo chico en `roles.spec.js`, que es donde vive el andamiaje de
 *   la segunda persona. Los tres roles tienen `movimiento:create`, así que no hay
 *   ningún rol que dé 403 y el único test posible es positivo.
 *
 * El stock se verifica SIEMPRE por ubicación con `stockEn`, nunca sobre
 * `stock.total`: una transferencia no cambia el total, así que una aserción sobre
 * el total pasa en verde aunque la transferencia no haya movido nada. El total
 * solo sirve para lo contrario — comprobar que se conserva.
 */

const DEPOSITO = "Depósito";

/** El techo del `integer` de Postgres, que es el que el backend hace respetar. */
const CANTIDAD_MAXIMA = 2147483647;

/**
 * Producto con stock en «Principal» y una segunda ubicación vacía.
 *
 * El orden importa y no es intercambiable: el alta del producto crea «Principal»
 * sola y le deja ahí el stock inicial, y la segunda ubicación se suma después. Al
 * revés no hay error —`resolverUbicacionParaAlta` elige en silencio la ubicación
 * más antigua del comercio— y el stock inicial caería en la equivocada, con lo que
 * el test seguiría en verde probando otra cosa.
 */
async function armarEscenario(api, { stockActual = "10", ...resto } = {}) {
  const producto = await crearProductoViaApi(api, { stockActual, ...resto });
  const deposito = await crearUbicacionViaApi(api, DEPOSITO);
  const principal = ubicacionPorNombre(
    await leerUbicaciones(api),
    UBICACION_POR_DEFECTO,
  );

  return { producto, principal, deposito };
}

test.describe("HU-12 — Transferencia entre ubicaciones", () => {
  test("transferir descuenta del origen, suma al destino y deja el par ligado", async ({
    page,
    api,
  }) => {
    const { producto, principal, deposito } = await armarEscenario(api);

    // Se entra por el link del inicio y no por la URL: es el camino real, y de
    // paso verifica que el acceso exista.
    await page.goto("/");
    await linkDesdeInicio(page).click();

    const pantalla = new Transferencias(page);
    await expect(pantalla.formulario).toBeVisible();

    await pantalla.elegir({ producto: producto.id, origen: principal.id });
    await pantalla.esperarDisponible(UBICACION_POR_DEFECTO);
    await expect(pantalla.disponible).toContainText(
      `Disponible en ${UBICACION_POR_DEFECTO}: 10 unidades`,
    );

    await pantalla.elegir({
      destino: deposito.id,
      cantidad: 3,
      motivo: "Reposición de góndola",
    });
    await pantalla.transferir();

    // (a) La confirmación, con los dos saldos. La frase completa y no un número
    // suelto: ver `confirmacionEsperada`.
    await expect(pantalla.confirmacion).toHaveText(
      confirmacionEsperada({
        producto: producto.nombre,
        cantidad: 3,
        origen: UBICACION_POR_DEFECTO,
        destino: DEPOSITO,
        saldoOrigen: 7,
        saldoDestino: 3,
      }),
    );

    // (b) El saldo real, por ubicación. El total tiene que seguir igual: la
    // mercadería se movió, no apareció ni desapareció.
    const detalle = await leerStock(api, producto.id);
    expect(stockEn(detalle, UBICACION_POR_DEFECTO)).toBe(7);
    expect(stockEn(detalle, DEPOSITO)).toBe(3);
    expect(detalle.total, "una transferencia no cambia el total").toBe(10);

    // (c) El criterio "queda registrada como un par ligado": exactamente dos
    // movimientos, mismo `transferenciaId`, uno negativo en el origen y uno
    // positivo en el destino.
    const { salida, entrada } = parDeTransferencia(
      await leerMovimientosDeTransferencia(api, producto.id),
    );

    expect(salida.cantidad).toBe(-3);
    expect(salida.ubicacion.nombre).toBe(UBICACION_POR_DEFECTO);
    expect(salida.tipo).toBe("transferencia");

    expect(entrada.cantidad).toBe(3);
    expect(entrada.ubicacion.nombre).toBe(DEPOSITO);
    expect(entrada.tipo).toBe("transferencia");
  });

  test("pedir más de lo disponible se frena en el navegador, sin llegar al backend", async ({
    page,
    api,
  }) => {
    const { producto, principal, deposito } = await armarEscenario(api);

    const pantalla = new Transferencias(page);
    // El contador se arma antes de navegar: cuenta desde el primer pedido.
    const posteos = contarPosteosDeTransferencia(page);

    await pantalla.ir();
    await pantalla.elegir({ producto: producto.id, origen: principal.id });
    await pantalla.esperarDisponible(UBICACION_POR_DEFECTO);

    await pantalla.elegir({ destino: deposito.id, cantidad: 11 });
    await pantalla.transferir();

    await expect(pantalla.errorDeCampo("cantidad")).toHaveText(
      `Hay 10 unidades disponibles en ${UBICACION_POR_DEFECTO}. No podés transferir más.`,
    );

    // El bloqueo local y el 409 del backend son dos caminos distintos y no tienen
    // que confundirse: el panel de aviso es exclusivo del rechazo del servidor.
    await expect(pantalla.avisoStock).toHaveCount(0);

    // Lo que separa "hay validación en el cliente" de "el backend lo rechazó y la
    // pantalla muestra ese rechazo". Sin este conteo las dos cosas se ven igual.
    expect(posteos, "el envío inválido no tiene que salir del navegador").toHaveLength(0);

    const detalle = await leerStock(api, producto.id);
    expect(stockEn(detalle, UBICACION_POR_DEFECTO)).toBe(10);
    expect(stockEn(detalle, DEPOSITO)).toBe(0);
  });

  test("si alguien vende entre que se cargó la pantalla y el envío, manda el backend", async ({
    page,
    api,
  }) => {
    // El backend como fuente de verdad: el disponible que la pantalla mostró dejó
    // de ser cierto, y el único que se da cuenta es el servidor.
    const { producto, principal, deposito } = await armarEscenario(api);

    const pantalla = new Transferencias(page);
    await pantalla.ir();
    await pantalla.elegir({ producto: producto.id, origen: principal.id });
    await pantalla.esperarDisponible(UBICACION_POR_DEFECTO);
    await expect(pantalla.disponible).toContainText(
      `Disponible en ${UBICACION_POR_DEFECTO}: 10 unidades`,
    );

    // La venta lleva `ubicacionId` explícito: con dos ubicaciones el backend lo
    // exige y sin él responde 400, o sea que el test fallaría antes de llegar al
    // 409 que viene a probar.
    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      ubicacionId: principal.id,
      tipo: "venta",
      cantidad: 8,
    });

    await pantalla.elegir({ destino: deposito.id, cantidad: 5 });
    await pantalla.transferir();

    // El mensaje del backend tal cual, y la indicación de qué hacer en un `<p>`
    // hermano: son dos párrafos, no un solo string, así que se afirman por
    // separado.
    await expect(pantalla.avisoStock).toContainText(
      "Stock insuficiente: hay 2 unidades disponibles y se intentan descontar 5",
    );
    await expect(pantalla.avisoStock).toContainText("Revisá la cantidad.");

    // El panel se corrige solo, sin recargar: el 409 dispara una re-consulta.
    await expect(pantalla.disponible).toContainText(
      `Disponible en ${UBICACION_POR_DEFECTO}: 2 unidades`,
    );

    const detalle = await leerStock(api, producto.id);
    expect(stockEn(detalle, UBICACION_POR_DEFECTO)).toBe(2);
    expect(stockEn(detalle, DEPOSITO)).toBe(0);

    expect(
      await leerMovimientosDeTransferencia(api, producto.id),
      "un rechazo no deja ninguna pata registrada",
    ).toHaveLength(0);
  });

  test("dos envíos en el mismo tick transfieren una sola vez", async ({
    page,
    api,
  }) => {
    // El endpoint no es idempotente, así que este es el test crítico de la HU: dos
    // envíos aceptados serían mercadería movida dos veces sin que nadie lo pida.
    const { producto, principal, deposito } = await armarEscenario(api);

    const pantalla = new Transferencias(page);
    const posteos = contarPosteosDeTransferencia(page);

    await pantalla.ir();
    await pantalla.elegir({ producto: producto.id, origen: principal.id });
    await pantalla.esperarDisponible(UBICACION_POR_DEFECTO);
    await pantalla.elegir({ destino: deposito.id, cantidad: 3 });

    await pantalla.dobleEnvio();

    await expect(pantalla.confirmacion).toBeVisible();

    expect(posteos, "el candado tiene que dejar pasar un solo envío").toHaveLength(1);

    // Y el efecto, que es lo que importa: un solo par en el libro y el saldo
    // movido una sola vez. Si el candado fallara, acá habría cuatro movimientos.
    parDeTransferencia(await leerMovimientosDeTransferencia(api, producto.id));

    const detalle = await leerStock(api, producto.id);
    expect(stockEn(detalle, UBICACION_POR_DEFECTO)).toBe(7);
    expect(stockEn(detalle, DEPOSITO)).toBe(3);
    expect(detalle.total).toBe(10);
  });

  test("superar el máximo de stock en el destino lo rechaza el backend", async ({
    page,
    api,
  }) => {
    // Este 409 no lo cubre ninguna otra capa: Backend/tests/transferencias.test.js
    // solo prueba el de stock insuficiente. Se llega dejando el destino en el
    // máximo exacto —el backend compara con `>`, así que el borde se acepta— y
    // transfiriendo una unidad más.
    const { producto, principal, deposito } = await armarEscenario(api, {
      stockActual: "0",
    });

    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      ubicacionId: deposito.id,
      tipo: "compra",
      cantidad: CANTIDAD_MAXIMA,
    });
    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      ubicacionId: principal.id,
      tipo: "compra",
      cantidad: 5,
    });

    const pantalla = new Transferencias(page);
    await pantalla.ir();
    await pantalla.elegir({ producto: producto.id, origen: principal.id });
    await pantalla.esperarDisponible(UBICACION_POR_DEFECTO);

    // Una sola unidad: pasa la validación local (1 ≤ 5) y muere en el destino.
    await pantalla.elegir({ destino: deposito.id, cantidad: 1 });
    await pantalla.transferir();

    // Sin tildes en «superaria» ni en «maximo»: así está en el backend, a
    // diferencia del resto de los mensajes.
    await expect(pantalla.avisoStock).toContainText(
      `El stock resultante superaria el maximo de ${CANTIDAD_MAXIMA} unidades: ` +
        `hay ${CANTIDAD_MAXIMA} y se intentan sumar 1`,
    );

    // El origen no perdió nada aunque la salida se había aplicado antes de que
    // fallara la entrada: el rollback queda observable de rebote.
    const detalle = await leerStock(api, producto.id);
    expect(stockEn(detalle, UBICACION_POR_DEFECTO)).toBe(5);
    expect(stockEn(detalle, DEPOSITO)).toBe(CANTIDAD_MAXIMA);
  });

  test("con una sola ubicación no hay formulario, sino a dónde configurarlas", async ({
    page,
    api,
  }) => {
    // El producto se crea igual —con stock 0, que no genera movimiento— para que
    // la pantalla no caiga en el estado de "todavía no hay productos", que es otro
    // bloqueo y encima no tiene testid. Así el test depende solo del que prueba.
    await crearProductoViaApi(api, { stockActual: "0" });

    const pantalla = new Transferencias(page);
    await pantalla.irSinFormulario();

    await expect(pantalla.sinUbicaciones).toContainText(
      "Para transferir necesitás al menos dos ubicaciones (por ejemplo Depósito y Local).",
    );
    await expect(pantalla.irAConfiguracion).toHaveAttribute(
      "href",
      "/configuracion?seccion=ubicaciones",
    );

    await expect(pantalla.formulario).toHaveCount(0);
  });

  test("el detalle del producto lleva a la transferencia con el producto puesto", async ({
    page,
    api,
  }) => {
    const { producto } = await armarEscenario(api);

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();
    await linkDesdeDetalle(page).click();

    const pantalla = new Transferencias(page);
    await expect(pantalla.formulario).toBeVisible();
    await expect(pantalla.producto).toHaveValue(producto.id);
  });

  test("con una sola ubicación el detalle no ofrece transferir", async ({
    page,
    api,
  }) => {
    // El link se condiciona a que el producto tenga dos o más filas de stock, que
    // con el `LEFT JOIN` desde `ubicacion` equivale a dos o más ubicaciones del
    // comercio. Sin la segunda, transferir no tendría a dónde.
    const producto = await crearProductoViaApi(api, { stockActual: "10" });

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();

    await expect(linkDesdeDetalle(page)).toHaveCount(0);
  });

  test("un producto en kg avisa que las cantidades van enteras", async ({
    page,
    api,
  }) => {
    const { producto, principal, deposito } = await armarEscenario(api, {
      unidadMedida: "kg",
      stockActual: "12",
    });

    const pantalla = new Transferencias(page);
    await pantalla.ir();
    await pantalla.elegir({ producto: producto.id, origen: principal.id });
    await pantalla.esperarDisponible(UBICACION_POR_DEFECTO);

    await expect(pantalla.ayudaEnteros).toHaveText(
      "Las transferencias se cargan en números enteros (por ejemplo 3 kg). " +
        "Todavía no se admiten fracciones.",
    );

    // La regla de pluralización es contrato: solo `unidad` se pluraliza, así que
    // acá va «12 kg» y no «12 kgs». Lo que sí se pluraliza aparte es
    // «disponible/disponibles» del tope.
    await expect(pantalla.disponible).toContainText(
      `Disponible en ${UBICACION_POR_DEFECTO}: 12 kg`,
    );

    await pantalla.elegir({ destino: deposito.id, cantidad: 13 });
    await pantalla.transferir();

    await expect(pantalla.errorDeCampo("cantidad")).toHaveText(
      `Hay 12 kg disponibles en ${UBICACION_POR_DEFECTO}. No podés transferir más.`,
    );
  });
});
