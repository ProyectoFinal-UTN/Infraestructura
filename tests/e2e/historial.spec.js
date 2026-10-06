import { expect, test } from "../soporte/fixtures.js";
import {
  crearProductoViaApi,
  crearUbicacionViaApi,
  enviarTransferencia,
  leerUbicaciones,
  registrarMovimientoViaApi,
  ubicacionPorNombre,
} from "../soporte/datos.js";
import { Historial } from "./soporte/historial.js";

/**
 * E2E de HU-14 — Historial de movimientos con filtros.
 *
 * Lo que agrega sobre `Backend/tests/historial.test.js`, que ya cubre la
 * validacion de cada filtro, la paginacion y el multi-tenant contra la API:
 * aca se prueba la PANTALLA. Que los filtros se elijan desde los
 * desplegables y se combinen, que vivan en la URL y sobrevivan a una recarga,
 * que cada movimiento muestre lo que hace falta para auditarlo, y los estados
 * que solo existen en la UI (sin resultados, rango invertido, paginacion).
 *
 * Los movimientos se arman por API: el escenario no es el sujeto del test, y
 * registrar cinco movimientos por pantalla haria la suite lenta sin probar
 * nada que no cubra ya `movimientos.spec.js` (HU-13).
 */

/**
 * Cinco movimientos sobre dos productos, en un orden conocido. Del mas viejo al
 * mas nuevo:
 *
 *   1. Yerba   ajuste +20  (el stock inicial del alta: lo registra el backend)
 *   2. Yerba   compra +10
 *   3. Yerba   venta   -3
 *   4. Harina  compra  +5  (la harina se da de alta en 0: sin movimiento)
 *   5. Harina  merma   -1  "Bolsa rota"
 */
async function escenario(api) {
  const yerba = await crearProductoViaApi(api, {
    nombre: "Yerba Playadito 1kg",
    stockActual: "20",
  });
  const harina = await crearProductoViaApi(api, {
    nombre: "Harina 000",
    categoria: "Almacén",
    unidadMedida: "kg",
    stockActual: "0",
  });

  await registrarMovimientoViaApi(api, {
    productoId: yerba.id,
    tipo: "compra",
    cantidad: 10,
  });
  await registrarMovimientoViaApi(api, {
    productoId: yerba.id,
    tipo: "venta",
    cantidad: 3,
  });
  await registrarMovimientoViaApi(api, {
    productoId: harina.id,
    tipo: "compra",
    cantidad: 5,
  });
  await registrarMovimientoViaApi(api, {
    productoId: harina.id,
    tipo: "merma",
    cantidad: 1,
    motivo: "Bolsa rota",
  });

  return { yerba, harina };
}

/** El día de hoy y el de mañana como los entiende un `<input type="date">`. */
async function fechasDelNavegador(page) {
  return page.evaluate(() => {
    const aTexto = (fecha) => fecha.toLocaleDateString("en-CA");
    const hoy = new Date();
    const manana = new Date(hoy.getTime() + 24 * 60 * 60 * 1000);
    return { hoy: aTexto(hoy), manana: aTexto(manana) };
  });
}

test.describe("HU-14 — Historial de movimientos", () => {
  test("se llega desde el inicio y muestra el libro del más nuevo al más viejo", async ({
    page,
    api,
  }) => {
    await escenario(api);

    await page.goto("/");
    await page.getByRole("link", { name: "Historial de movimientos" }).click();

    const historial = new Historial(page);
    await historial.esperarCarga();

    await expect(historial.contador).toHaveText("5 movimientos");
    await expect(historial.movimientos).toHaveCount(5);

    // El primero es el último que se registró, y el último es el stock
    // inicial del alta.
    await expect(historial.movimientos.first()).toContainText("Harina 000");
    await expect(historial.movimientos.first()).toContainText("Merma");
    await expect(historial.movimientos.last()).toContainText(
      "Stock inicial del alta del producto",
    );
  });

  test("cada movimiento muestra lo necesario para auditarlo", async ({
    page,
    api,
    comercio,
  }) => {
    const { yerba } = await escenario(api);

    const historial = new Historial(page);
    await historial.ir();

    const venta = historial
      .movimientosDe("Yerba Playadito 1kg")
      .filter({ hasText: "Venta" });

    await expect(venta).toHaveCount(1);
    // La cantidad sale con signo, y el nombre accesible dice si entró o salió.
    await expect(venta.getByLabel("Salida de 3 unidad")).toHaveText(/−3/);
    await expect(venta).toContainText("Principal");
    await expect(venta).toContainText(yerba.codigoBarras);
    // Quien lo registró: el andamiaje da de alta con nombre.
    await expect(venta).toContainText(`Comercio E2E ${comercio.etiqueta}`);

    // La merma, con su motivo y marcada como corrección (criterio de HU-15).
    const merma = historial.movimientosDe("Harina 000").filter({ hasText: "Merma" });
    await expect(merma).toContainText("Merma · corrección");
    await expect(merma).toContainText("Bolsa rota");
    await expect(merma.getByLabel("Salida de 1 kg")).toBeVisible();
  });

  test("filtra por producto y por tipo, y los filtros se combinan", async ({
    page,
    api,
  }) => {
    await escenario(api);

    const historial = new Historial(page);
    await historial.ir();

    await historial.producto.selectOption({ label: "Harina 000" });
    await expect(historial.contador).toHaveText("2 movimientos");
    await expect(historial.movimientosDe("Yerba Playadito 1kg")).toHaveCount(0);

    await historial.tipo.selectOption({ label: "Compra" });
    await expect(historial.contador).toHaveText("1 movimiento");
    await expect(historial.movimientos).toHaveCount(1);
    await expect(historial.movimientos.first()).toContainText("Harina 000");
    await expect(historial.movimientos.first()).toContainText("Compra");

    // Volver a «Todos» en producto deja solo el tipo: las compras de los dos.
    await historial.producto.selectOption({ label: "Todos" });
    await expect(historial.contador).toHaveText("2 movimientos");
  });

  test("los filtros viven en la URL: sobreviven a una recarga", async ({
    page,
    api,
  }) => {
    await escenario(api);

    const historial = new Historial(page);
    await historial.ir();

    await historial.tipo.selectOption({ label: "Venta" });
    await expect(page).toHaveURL(/[?&]tipo=venta/);
    await expect(historial.contador).toHaveText("1 movimiento");

    await page.reload();
    await historial.esperarCarga();

    await expect(historial.tipo).toHaveValue("venta");
    await expect(historial.contador).toHaveText("1 movimiento");
  });

  test("sin resultados lo dice, y «Limpiar filtros» vuelve a mostrar todo", async ({
    page,
    api,
  }) => {
    await escenario(api);

    const historial = new Historial(page);
    await historial.ir();

    // No hubo ninguna transferencia en el escenario.
    await historial.tipo.selectOption({ label: "Transferencia" });

    await expect(historial.sinResultados).toBeVisible();
    await expect(historial.contador).toHaveText("0 movimientos");

    await historial.limpiarFiltros.click();

    await expect(historial.contador).toHaveText("5 movimientos");
    await expect(page).not.toHaveURL(/tipo=/);
  });

  test("un comercio sin movimientos lo dice, distinto de un filtro vacío", async ({
    page,
  }) => {
    const historial = new Historial(page);
    await historial.ir();

    await expect(historial.sinMovimientos).toBeVisible();
    await expect(historial.sinResultados).toHaveCount(0);
  });

  test("filtra por rango de fechas", async ({ page, api }) => {
    await escenario(api);

    const historial = new Historial(page);
    await historial.ir();
    const { hoy, manana } = await fechasDelNavegador(page);

    // Todo el escenario se registró hoy.
    await historial.desde.fill(hoy);
    await historial.hasta.fill(hoy);
    await expect(historial.contador).toHaveText("5 movimientos");

    // Desde mañana no hay nada. Se borra primero «Hasta», que si no quedaría
    // antes que «Desde».
    await historial.hasta.fill("");
    await historial.desde.fill(manana);
    await expect(historial.sinResultados).toBeVisible();
  });

  test("un rango invertido avisa al lado de las fechas en vez de consultar", async ({
    page,
  }) => {
    // Desde la pantalla no se puede armar —cada fecha limita a la otra con
    // `min`/`max`—, pero sí llega así por un link. Esa es la puerta que se
    // prueba.
    const historial = new Historial(page);
    await page.goto("/movimientos?desde=2026-10-10&hasta=2026-10-01");
    await expect(historial.titulo).toBeVisible();

    await expect(historial.errorDeRango).toBeVisible();
    await expect(historial.contador).toHaveCount(0);
  });

  test("el producto dado de baja sigue en el historial", async ({
    page,
    api,
  }) => {
    // La baja es lógica (HU-9): esconder sus movimientos rompería la
    // auditoría, que es para lo que existe esta pantalla.
    const descontinuado = await crearProductoViaApi(api, {
      nombre: "Gaseosa Descontinuada",
      stockActual: "4",
    });

    const baja = await api.delete(`/api/productos/${descontinuado.id}`);
    expect(baja.ok(), `No se pudo dar de baja: ${await baja.text()}`).toBe(true);

    const historial = new Historial(page);
    await historial.ir();

    const fila = historial.movimientosDe("Gaseosa Descontinuada");
    await expect(fila).toHaveCount(1);
    await expect(fila).toContainText("(dado de baja)");
  });

  test("una transferencia se ve como dos movimientos, y se puede filtrar por ubicación", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, {
      nombre: "Agua Villavicencio 2l",
      stockActual: "10",
    });
    await crearUbicacionViaApi(api, "Depósito");
    const ubicaciones = await leerUbicaciones(api);

    const transferencia = await enviarTransferencia(api, {
      productoId: producto.id,
      ubicacionOrigenId: ubicacionPorNombre(ubicaciones, "Principal").id,
      ubicacionDestinoId: ubicacionPorNombre(ubicaciones, "Depósito").id,
      cantidad: 4,
    });
    expect(
      transferencia.status(),
      `No se pudo transferir: ${await transferencia.text()}`,
    ).toBe(201);

    const historial = new Historial(page);
    await historial.ir();

    const patas = historial.movimientos.filter({ hasText: "Transferencia" });
    await expect(patas).toHaveCount(2);
    await expect(patas.filter({ hasText: "Principal" }).getByLabel("Salida de 4 unidad")).toBeVisible();
    await expect(patas.filter({ hasText: "Depósito" }).getByLabel("Entrada de 4 unidad")).toBeVisible();

    // Con dos ubicaciones aparece el filtro, y deja solo la pata de destino.
    await historial.ubicacion.selectOption({ label: "Depósito" });
    await expect(historial.contador).toHaveText("1 movimiento");
    await expect(
      historial.movimientos.first().getByLabel("Entrada de 4 unidad"),
    ).toBeVisible();
  });

  test("con más de 50 movimientos pagina, y la página vive en la URL", async ({
    page,
    api,
  }) => {
    // 51 movimientos: uno más que la página de 50 que pide la pantalla.
    test.setTimeout(120_000);

    const producto = await crearProductoViaApi(api, {
      nombre: "Chicle Beldent",
      stockActual: "0",
    });

    // En tandas de 10 en paralelo y no de a uno: de a uno, cada ida y vuelta a
    // Neon suma y el armado tardaba casi dos minutos, al borde del timeout. Son
    // todas compras del mismo producto, así que el orden entre ellas no
    // importa; el backend las serializa con el lock de la fila de stock.
    const registrarCompra = () =>
      registrarMovimientoViaApi(api, {
        productoId: producto.id,
        tipo: "compra",
        cantidad: 1,
      });
    for (let hechas = 0; hechas < 51; hechas += 10) {
      const tanda = Math.min(10, 51 - hechas);
      await Promise.all(Array.from({ length: tanda }, registrarCompra));
    }

    const historial = new Historial(page);
    await historial.ir();

    await expect(historial.contador).toHaveText("51 movimientos");
    await expect(historial.movimientos).toHaveCount(50);
    await expect(historial.textoDePagina(1, 2)).toBeVisible();
    await expect(historial.anterior).toBeDisabled();

    await historial.siguiente.click();

    await expect(historial.textoDePagina(2, 2)).toBeVisible();
    await expect(historial.movimientos).toHaveCount(1);
    await expect(historial.siguiente).toBeDisabled();
    await expect(page).toHaveURL(/[?&]pagina=2/);

    await historial.anterior.click();
    await expect(historial.textoDePagina(1, 2)).toBeVisible();
    await expect(page).not.toHaveURL(/pagina=/);
  });
});
