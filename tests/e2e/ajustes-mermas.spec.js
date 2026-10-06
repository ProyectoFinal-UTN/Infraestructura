import { expect, test } from "../soporte/fixtures.js";
import {
  crearProductoViaApi,
  leerMovimientos,
  leerStock,
  registrarMovimientoViaApi,
  stockEn,
} from "../soporte/datos.js";
import {
  DetalleProducto,
  contarPosteosDeMovimiento,
} from "./soporte/detalleProducto.js";
import {
  Movimientos,
  UBICACION_POR_DEFECTO,
  confirmacionEsperada,
} from "./soporte/movimientos.js";

/**
 * E2E de HU-15 — ajustes y mermas con motivo obligatorio.
 *
 * Corren contra el stack completo levantado con `docker compose up --build`: el
 * bundle de produccion del Frontend, servido por Nginx, hablando con el Backend
 * real y con Neon.
 *
 * Los dos lugares donde se registra una correccion de stock piden el motivo: el
 * formulario de «Registrar movimiento» (merma y ajuste) y el ajuste inline de
 * la pantalla de detalle (siempre un ajuste). Los dos se prueban igual: sin
 * motivo —o con un motivo en blanco— no sale nada al backend, y con motivo se
 * registra.
 *
 * Por que se cuentan los POST: «se muestra el error» no alcanza para probar que
 * la validacion es del navegador. Desde HU-15 el backend tambien rechaza con un
 * 400, y la pantalla podria estar mostrando ese rechazo. El contrato del 400 se
 * prueba aparte, contra la API, en tests/api/ajustes-mermas.spec.js.
 *
 * El historial (`/movimientos`) es la pantalla de HU-14. Aca se usa solo para
 * el criterio propio de HU-15 —que el motivo se vea y que la correccion quede
 * diferenciada de una venta—; sus filtros y su paginacion no son de esta suite.
 *
 * Cada test trae su propio comercio (fixture `comercio`), asi que arranca sin
 * productos ni movimientos y se puede correr suelto, en cualquier orden y en
 * paralelo.
 */

const ERROR_MOTIVO = "Escribí el motivo de este movimiento.";

/** Los dos tipos del formulario que exigen motivo. */
const TIPOS_CON_MOTIVO = [
  { tipo: "merma", articulo: "una", saldo: 18 },
  { tipo: "ajuste", articulo: "un", sentido: "salida", saldo: 18 },
];

test.describe("HU-15 — Ajustes y mermas", () => {
  for (const caso of TIPOS_CON_MOTIVO) {
    test(`${caso.articulo} ${caso.tipo} sin motivo no se envía, y con motivo se registra`, async ({
      page,
      api,
    }) => {
      const producto = await crearProductoViaApi(api, { stockActual: "20" });

      const movimientos = new Movimientos(page);
      await movimientos.ir();

      // Se empiezan a contar antes de tocar nada.
      const posteos = contarPosteosDeMovimiento(page);

      await movimientos.completar({
        producto: producto.nombre,
        tipo: caso.tipo,
        sentido: caso.sentido,
        cantidad: 2,
      });
      await movimientos.registrar();

      // El aviso queda anclado al campo, no suelto en la pantalla.
      await expect(movimientos.errorDeCampo("motivo")).toHaveText(ERROR_MOTIVO);
      await expect(movimientos.confirmacion).toHaveCount(0);

      // Unos espacios no son un motivo: la pantalla recorta antes de validar.
      await movimientos.completar({ motivo: "   " });
      await movimientos.registrar();

      await expect(movimientos.errorDeCampo("motivo")).toHaveText(ERROR_MOTIVO);
      await expect(movimientos.confirmacion).toHaveCount(0);

      // Ninguno de los dos intentos salio del navegador, y el stock sigue igual.
      expect(posteos, "un movimiento sin motivo llegó al backend").toHaveLength(0);
      expect(stockEn(await leerStock(api, producto.id), UBICACION_POR_DEFECTO)).toBe(20);

      // Con el motivo escrito se registra. Es lo que le da sentido al conteo
      // de arriba: si los POST nunca se contaran, el `toHaveLength(0)` pasaria
      // sin probar nada.
      await movimientos.completar({ motivo: "Se vencieron dos unidades" });
      await movimientos.registrar();

      await expect(movimientos.confirmacion).toHaveText(
        confirmacionEsperada({
          producto: producto.nombre,
          saldo: caso.saldo,
          ubicacion: UBICACION_POR_DEFECTO,
        }),
      );
      await expect(movimientos.errorDeCampo("motivo")).toHaveCount(0);
      expect(posteos).toHaveLength(1);
      expect(stockEn(await leerStock(api, producto.id), UBICACION_POR_DEFECTO)).toBe(
        caso.saldo,
      );

      // El motivo se limpia aunque el tipo quede elegido: el siguiente
      // movimiento rara vez es por lo mismo.
      await expect(movimientos.tipo).toHaveValue(caso.tipo);
      await expect(movimientos.motivo).toHaveValue("");
    });
  }

  test("en compras y ventas el motivo no se pide", async ({ page, api }) => {
    await crearProductoViaApi(api, { stockActual: "20" });

    const movimientos = new Movimientos(page);
    await movimientos.ir();

    // Sumarle un campo a los tipos de todos los dias seria un paso mas en el
    // flujo mas usado (RNF1): el campo no existe en compra ni en venta.
    for (const tipo of ["compra", "venta"]) {
      await movimientos.completar({ tipo });
      await expect(movimientos.motivo, `tipo ${tipo}`).toHaveCount(0);
    }

    // Y pasar de una merma a una venta no arrastra el motivo escrito: al
    // volver a la merma el campo esta vacio.
    await movimientos.completar({ tipo: "merma", motivo: "Se venció" });
    await movimientos.completar({ tipo: "venta" });
    await expect(movimientos.motivo).toHaveCount(0);

    await movimientos.completar({ tipo: "merma" });
    await expect(movimientos.motivo).toHaveValue("");
  });

  test("el ajuste inline del detalle tampoco sale sin motivo", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "20" });

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();

    const posteos = contarPosteosDeMovimiento(page);

    // Cantidad y sentido correctos: el unico problema es el motivo.
    await detalle.ajustar(UBICACION_POR_DEFECTO, {
      cantidad: 3,
      sentido: "salida",
    });

    await expect(
      detalle.errorDeCampo(UBICACION_POR_DEFECTO, "motivo"),
    ).toHaveText(ERROR_MOTIVO);
    await expect(
      detalle.errorDeCampo(UBICACION_POR_DEFECTO, "cantidad"),
    ).toHaveCount(0);
    await expect(
      detalle.errorDeCampo(UBICACION_POR_DEFECTO, "sentido"),
    ).toHaveCount(0);

    await detalle.ajustar(UBICACION_POR_DEFECTO, { motivo: "   " });

    await expect(
      detalle.errorDeCampo(UBICACION_POR_DEFECTO, "motivo"),
    ).toHaveText(ERROR_MOTIVO);

    expect(posteos, "un ajuste sin motivo llegó al backend").toHaveLength(0);
    await expect(detalle.cantidadEn(UBICACION_POR_DEFECTO)).toHaveText("20");
    expect(stockEn(await leerStock(api, producto.id), UBICACION_POR_DEFECTO)).toBe(20);

    await detalle.ajustar(UBICACION_POR_DEFECTO, { motivo: "Rotura en el salón" });

    await expect(detalle.cantidadEn(UBICACION_POR_DEFECTO)).toHaveText("17");
    await expect(
      detalle.errorDeCampo(UBICACION_POR_DEFECTO, "motivo"),
    ).toHaveCount(0);
    expect(posteos).toHaveLength(1);
    expect(stockEn(await leerStock(api, producto.id), UBICACION_POR_DEFECTO)).toBe(17);
  });

  test("el motivo queda guardado y se ve en el historial, diferenciado de una venta", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "20" });
    const motivo = "Se vencieron tres yogures";

    // La merma se registra por pantalla, que es el camino real del usuario.
    const movimientos = new Movimientos(page);
    await movimientos.ir();
    await movimientos.completar({
      producto: producto.nombre,
      tipo: "merma",
      motivo,
      cantidad: 3,
    });
    await movimientos.registrar();
    await expect(movimientos.confirmacion).toHaveText(
      confirmacionEsperada({
        producto: producto.nombre,
        saldo: 17,
        ubicacion: UBICACION_POR_DEFECTO,
      }),
    );

    // Y una venta sin motivo como contraste: es la que tiene que verse distinta.
    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      tipo: "venta",
      cantidad: 1,
    });

    // Se guardo tal cual se escribio, en el movimiento que corresponde.
    const libro = await leerMovimientos(api, producto.id);
    const merma = libro.find((uno) => uno.tipo === "merma");
    expect(merma).toMatchObject({ cantidad: -3, motivo });

    // En el historial: el movimiento muestra su motivo y se marca como
    // correccion. Se ancla por el motivo y no por el tipo, porque el alta del
    // producto ya dejo otro movimiento corrector (el ajuste del stock inicial).
    await page.goto(`/movimientos?productoId=${producto.id}`);
    await expect(
      page.getByRole("heading", { name: "Historial de movimientos" }),
    ).toBeVisible();

    const filaMerma = page.getByRole("listitem").filter({ hasText: motivo });
    await expect(filaMerma).toHaveCount(1);
    await expect(filaMerma).toContainText("Merma · corrección");
    await expect(
      filaMerma
        .getByText("Motivo", { exact: true })
        .locator("xpath=following-sibling::dd[1]"),
    ).toHaveText(motivo);

    // La venta, en cambio, ni se marca como correccion ni muestra un motivo
    // vacio: no tiene esa fila.
    const filaVenta = page
      .getByRole("listitem")
      .filter({ has: page.getByText("Venta", { exact: true }) });
    await expect(filaVenta).toHaveCount(1);
    await expect(filaVenta).not.toContainText("corrección");
    await expect(filaVenta.getByText("Motivo", { exact: true })).toHaveCount(0);
  });
});
