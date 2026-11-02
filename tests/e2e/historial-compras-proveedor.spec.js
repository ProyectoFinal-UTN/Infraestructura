import { expect, test } from "../soporte/fixtures.js";
import { crearProductoViaApi, crearProveedorViaApi } from "../soporte/datos.js";
import { abrirComo, crearOtroComercio, sumarMiembro } from "../soporte/equipo.js";
import {
  PERIODO_SIN_COMPRAS,
  crearCompraViaApi,
  darDeBajaProveedorViaApi,
  escenarioDeCompras,
  leerHistorialViaApi,
} from "../soporte/comprasProveedor.js";
import { HistorialCompras } from "./soporte/historialCompras.js";
import { Proveedores } from "./soporte/proveedores.js";

/**
 * E2E de HU-21 — Historial de compras por proveedor (SCRUM-33 / SCRUM-133).
 *
 * Lo que agrega sobre lo que ya esta cubierto en otro lado:
 *
 * - `Backend/tests/` valida los formatos de fecha uno por uno, la combinatoria
 *   de filtros, los codigos de error y el aislamiento a nivel query.
 * - Los unitarios del Frontend dibujan cada estado por separado con el service
 *   mockeado: vacio, pagina vacia, 400, 404 y badges.
 *
 * Aca se recorre el camino completo contra datos y backend reales: que se llegue
 * a la pantalla desde el directorio, que el resumen de un periodo real cierre
 * con las compras que se registraron, que los filtros vivan en la URL, y que la
 * sesion por cookie a traves de Nginx no saltee el aislamiento por comercio.
 *
 * Las compras se crean por el flujo real de HU-13 (ver la nota sobre las fechas
 * en `tests/soporte/comprasProveedor.js`).
 *
 * ---------------------------------------------------------------------------
 * QUE NO SE PRUEBA ACA, Y POR QUE
 *
 * - MONTOS. No existen en el sistema: `resumen.montos` es siempre `null` y la
 *   pantalla no dibuja ningun importe. No hay una sola asercion sobre dinero.
 * - Quien registro la compra. Ese dato NO viene en este endpoint.
 * - Los botones de paginacion (anterior/siguiente). La pantalla nunca manda
 *   `limite` —solo `desde`, `hasta` y `pagina`—, asi que el limite es siempre el
 *   default de 50 y la navegacion solo se dibuja con `totalPaginas > 1`: harian
 *   falta 51 compras creadas de a una contra Neon para ver un boton. Lo que SI
 *   se cubre aca es el borde de contrato, que es barato y es el que se rompe:
 *   `?pagina=99` y la ausencia de la navegacion cuando hay una sola pagina. Los
 *   botones en si los cubren los unitarios del Frontend.
 * - El 400 del backend por fecha invalida. Es INALCANZABLE desde la UI: el
 *   service normaliza cualquier "AAAA-MM-DD" a ISO con zona y descarta lo que no
 *   tenga esa forma, asi que ninguna URL lo provoca. Se cubre por API en
 *   `tests/api/historial-compras-proveedor.spec.js`.
 */

test.describe("HU-21 — Historial de compras por proveedor", () => {
  test("se entra desde el directorio y se ve el encabezado, el resumen y las filas", async ({
    page,
    api,
  }) => {
    const { proveedor, unidades, idsEnPantalla } = await escenarioDeCompras(api);

    // Por el camino de la UI: el link «Ver compras» de la fila. Antes iba al
    // historial general filtrado por proveedor; ahora a esta pantalla.
    const proveedores = new Proveedores(page);
    await proveedores.ir();
    await proveedores
      .fila(proveedor.nombre)
      .getByRole("link", { name: `Ver compras a ${proveedor.nombre}` })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/proveedores/${proveedor.id}/compras$`),
    );

    const historial = new HistorialCompras(page);
    await historial.esperarCarga();

    // El contrato pide un heading nivel 1 con el nombre del proveedor.
    await expect(historial.titulo).toHaveText(proveedor.nombre);

    // El resumen es de TODO el periodo, no de la pagina. Los numeros salen de
    // las compras que registro el andamiaje: 3 compras, 22 unidades.
    await expect(historial.resumenCompras).toHaveText("3");
    await expect(historial.resumenUnidades).toHaveText(String(unidades));
    // Primera y ultima existen (no son el "—" del periodo vacio). No se compara
    // la fecha exacta: la pone la base con su `now()`.
    await expect(historial.resumenPrimera).not.toHaveText("—");
    await expect(historial.resumenUltima).not.toHaveText("—");

    // Las filas, y en el orden que promete la pantalla: de la mas reciente a la
    // mas antigua. Se comparan los ids y no los textos, que son copys.
    await expect(historial.filas).toHaveCount(3);
    expect(await historial.idsVisibles()).toEqual(idsEnPantalla);

    // Una compra es una entrada: la cantidad va SIN signo, a diferencia de
    // HU-14, donde el historial mezcla salidas y las muestra en negativo. La
    // mas reciente es la de 12.
    // Alcanza con que el locator resuelva: busca por el nombre accesible exacto
    // («12 unidad»), asi que si la cantidad fuera otra no encontraria nada y
    // esto fallaria. No se compara el texto visible porque el `<p>` lleva el
    // numero y la unidad pegados ("12unidad"), y asertar ese string seria atarse
    // al markup.
    const masReciente = idsEnPantalla[0];
    await expect(
      historial.cantidadDe(masReciente, { cantidad: 12 }),
    ).toBeVisible();
    // Y no hay ningun "+12" ni "−12": un signo sugeriria que existe el otro, y
    // en esta pantalla no existe. Se cubren las dos variantes del menos, el
    // guion y el menos tipografico (U+2212).
    for (const conSigno of ["+12", "-12", "−12"]) {
      await expect(historial.fila(masReciente)).not.toContainText(conSigno);
    }

    // Ninguno de los estados excluyentes esta puesto.
    await expect(historial.vacio).toHaveCount(0);
    await expect(historial.paginaVacia).toHaveCount(0);
    await expect(historial.error).toHaveCount(0);
  });

  test("un período sin compras muestra el vacío, el resumen en cero y ninguna paginación", async ({
    page,
    api,
  }) => {
    const { proveedor } = await escenarioDeCompras(api);

    const historial = new HistorialCompras(page);
    await historial.ir(proveedor.id);
    await expect(historial.filas).toHaveCount(3);

    await historial.filtrarPorPeriodo(PERIODO_SIN_COMPRAS);

    // El testid especifico, no "no hay ningun alert": ni este estado ni el de
    // pagina vacia llevan `role="alert"`, asi que esa asercion pasaria en los
    // dos sin distinguirlos.
    await expect(historial.vacio).toBeVisible();
    await expect(historial.paginaVacia).toHaveCount(0);
    await expect(historial.error).toHaveCount(0);
    await expect(historial.filas).toHaveCount(0);

    await expect(historial.resumenCompras).toHaveText("0");
    await expect(historial.resumenUnidades).toHaveText("0");
    await expect(historial.resumenPrimera).toHaveText("—");
    await expect(historial.resumenUltima).toHaveText("—");

    // El contrato dice que sin compras en el periodo `totalPaginas` es 0 y NO 1.
    // La navegacion solo se dibuja con `totalPaginas > 1`, y el texto
    // «Mostrando … de 0» vive adentro de esa navegacion. O sea que si el backend
    // volviera a mandar 1, la navegacion apareceria y con ella el "de 0". Es el
    // guardian de esa regla, no un chequeo de copy.
    await expect(historial.paginacion).toHaveCount(0);
    await expect(page.getByText("de 0")).toHaveCount(0);

    // Y el periodo se puede sacar: vuelven las tres compras.
    await historial.limpiar.click();
    await historial.esperarCarga();
    await expect(historial.filas).toHaveCount(3);
  });

  test("una página más allá del total no es un error", async ({ page, api }) => {
    const { proveedor } = await escenarioDeCompras(api);

    const historial = new HistorialCompras(page);
    await historial.ir(proveedor.id, "?pagina=99");

    // 200 con la lista vacia y `total > 0`: se pidio una pagina que no existe.
    // Es un estado propio, distinto del vacio, y a proposito.
    await expect(historial.paginaVacia).toBeVisible();
    await expect(historial.vacio).toHaveCount(0);
    await expect(historial.error).toHaveCount(0);
    await expect(historial.sinProveedor).toHaveCount(0);
    await expect(historial.filas).toHaveCount(0);

    // No es una falla, asi que no se anuncia como tal.
    await expect(page.getByRole("alert")).toHaveCount(0);

    // El resumen es del periodo y no de la pagina: sigue mostrando las tres
    // compras aunque esta pagina no tenga ninguna.
    await expect(historial.resumenCompras).toHaveText("3");

    // Y tiene la salida puesta.
    await page.getByRole("button", { name: "Volver a la primera" }).click();
    await historial.esperarCarga();
    await expect(historial.filas).toHaveCount(3);
  });

  test("un rango invertido lo frena la pantalla, pegado al campo «Desde»", async ({
    page,
    api,
  }) => {
    const { proveedor } = await escenarioDeCompras(api);

    // Armado a mano por URL y no tipeando: el `<input type="date">` de «Hasta»
    // lleva `min={desde}`, asi que la pantalla ya no deja elegir un rango al
    // reves desde el calendario. Por URL si entra, que es como llegaria un link
    // viejo o un favorito.
    const historial = new HistorialCompras(page);
    await historial.ir(proveedor.id, "?desde=2026-02-01&hasta=2026-01-31");

    // Mensaje pegado al campo, no en `historial-compras-error`: con el rango al
    // reves el Frontend NO consulta, asi que el 400 del backend nunca llega.
    await expect(historial.errorDeRango).toContainText("no puede ser posterior");
    await expect(historial.error).toHaveCount(0);

    // Y no muestra datos viejos al lado del error.
    await expect(historial.filas).toHaveCount(0);
    await expect(historial.resumen).toHaveCount(0);
  });

  test("un proveedor dado de baja sigue mostrando sus compras, con el badge", async ({
    page,
    api,
  }) => {
    const { proveedor, idsEnPantalla } = await escenarioDeCompras(api);

    await darDeBajaProveedorViaApi(api, proveedor.id);

    // Por URL directa, que es el UNICO camino: el directorio lista solo
    // activos, asi que a esta pantalla no se llega navegando. Es tambien la
    // diferencia con HU-19, donde `GET /api/proveedores/:id` responde 404 para
    // un dado de baja: ESTE endpoint si sirve sus compras, porque lo que se le
    // compro sigue siendo historia valida.
    const historial = new HistorialCompras(page);
    await historial.ir(proveedor.id);

    await expect(historial.titulo).toContainText(proveedor.nombre);
    await expect(historial.proveedorDadoDeBaja).toBeVisible();

    // Lo que importa: la baja no se llevo las compras.
    await expect(historial.filas).toHaveCount(3);
    expect(await historial.idsVisibles()).toEqual(idsEnPantalla);
    await expect(historial.resumenCompras).toHaveText("3");
    await expect(historial.sinProveedor).toHaveCount(0);
  });

  test("el empleado puede consultar el historial", async ({
    api,
    browser,
    playwright,
  }) => {
    const { proveedor, unidades } = await escenarioDeCompras(api);

    // El permiso que la ruta exige es `movimiento: ["read"]`, que los tres roles
    // tienen: entra tambien el empleado, aunque la historia este escrita "como
    // gerente".
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const { context, page } = await abrirComo(browser, empleado.storageState);

    try {
      const historial = new HistorialCompras(page);
      await historial.ir(proveedor.id);

      await expect(historial.titulo).toHaveText(proveedor.nombre);
      await expect(historial.filas).toHaveCount(3);
      await expect(historial.resumenUnidades).toHaveText(String(unidades));

      // Lo que NO tiene que pasar: que el fail-closed de permisos lo rebote.
      await expect(historial.sinProveedor).toHaveCount(0);
      await expect(historial.error).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("una compra recién registrada aparece en el historial de su proveedor", async ({
    page,
    api,
  }) => {
    const { proveedor, yerba, unidades } = await escenarioDeCompras(api);

    const historial = new HistorialCompras(page);
    await historial.ir(proveedor.id);
    await expect(historial.filas).toHaveCount(3);

    // La compra nueva va por el flujo real de HU-13, igual que las del
    // andamiaje.
    const nueva = await crearCompraViaApi(api, {
      productoId: yerba.id,
      proveedorId: proveedor.id,
      cantidad: 5,
    });

    await page.reload();
    await historial.esperarCarga();

    // Aparece, y arriba: el historial va de lo mas nuevo a lo mas viejo.
    await expect(historial.filas).toHaveCount(4);
    await expect(historial.fila(nueva.id)).toBeVisible();
    expect((await historial.idsVisibles())[0]).toBe(String(nueva.id));

    // Y el resumen la sumo. Es el numero que delata un resumen calculado sobre
    // la pagina en vez del periodo.
    await expect(historial.resumenCompras).toHaveText("4");
    await expect(historial.resumenUnidades).toHaveText(String(unidades + 5));
  });

  test("un comercio no ve las compras de otro", async ({
    api,
    browser,
    playwright,
  }) => {
    const { proveedor } = await escenarioDeCompras(api);

    // Un comercio aparte, recien registrado y vacio.
    const otro = await crearOtroComercio(playwright);

    try {
      // Su propio proveedor con su propia compra, para que el test distinga "no
      // ve nada" de "no ve lo ajeno".
      const suProveedor = await crearProveedorViaApi(otro.api);
      const suProducto = await crearProductoViaApi(otro.api, {
        nombre: `Fideos HU21 ${Date.now() % 100000}`,
        stockActual: "0",
      });
      const suCompra = await crearCompraViaApi(otro.api, {
        productoId: suProducto.id,
        proveedorId: suProveedor.id,
        cantidad: 4,
      });

      const { context, page } = await abrirComo(browser, otro.storageState);

      try {
        const historial = new HistorialCompras(page);

        // En su propio historial ve lo suyo, y solo lo suyo.
        await historial.ir(suProveedor.id);
        await expect(historial.filas).toHaveCount(1);
        expect(await historial.idsVisibles()).toEqual([String(suCompra.id)]);
        await expect(historial.resumenUnidades).toHaveText("4");

        // Y con el id del proveedor del OTRO comercio en la URL, la pantalla
        // dice que no existe. 404 y no 403: un 403 confirmaria que ese id existe
        // en algun comercio, que es justo lo que no se puede filtrar.
        await historial.ir(proveedor.id);
        await expect(historial.sinProveedor).toBeVisible();
        await expect(historial.filas).toHaveCount(0);
        await expect(historial.resumen).toHaveCount(0);
      } finally {
        await context.close();
      }
    } finally {
      await otro.api.dispose();
    }

    // La contraprueba: las compras del comercio del test siguen enteras. Un
    // aislamiento que ademas borrara datos pasaria las aserciones de arriba.
    const mio = await leerHistorialViaApi(api, proveedor.id);
    expect(mio.resumen.compras).toBe(3);
  });

  test("un producto dado de baja se sigue viendo en su fila, con el badge", async ({
    page,
    api,
  }) => {
    const proveedor = await crearProveedorViaApi(api);
    const producto = await crearProductoViaApi(api, {
      nombre: `Gaseosa HU21 ${Date.now() % 100000}`,
      stockActual: "0",
    });

    const compra = await crearCompraViaApi(api, {
      productoId: producto.id,
      proveedorId: proveedor.id,
      cantidad: 9,
    });

    const baja = await api.delete(`/api/productos/${producto.id}`);
    expect(baja.ok(), `No se pudo dar de baja: ${await baja.text()}`).toBe(true);

    const historial = new HistorialCompras(page);
    await historial.ir(proveedor.id);

    // Esconder la fila haria que las unidades del resumen no cerraran con las
    // filas visibles, y el comerciante veria un total que no puede reconstruir.
    await expect(historial.filas).toHaveCount(1);
    await expect(historial.fila(compra.id)).toBeVisible();
    await expect(
      historial.fila(compra.id).getByTestId("producto-dado-de-baja"),
    ).toBeVisible();

    // El resumen no bajo con la baja.
    await expect(historial.resumenCompras).toHaveText("1");
    await expect(historial.resumenUnidades).toHaveText("9");
  });
});
