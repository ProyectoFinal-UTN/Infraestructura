import { expect, test } from "../soporte/fixtures.js";
import { abrirComo, sumarMiembro } from "../soporte/equipo.js";
import {
  MENSAJE_SIN_MOVIMIENTOS,
  RANGO_SIN_MOVIMIENTOS,
  RUTA_REPORTE,
  escenarioDeReporte,
  nombreDeArchivoEsperado,
  ponerNombreAlComercio,
  rangoComoEnPdf,
} from "../soporte/reportes.js";
import { Accesos } from "./soporte/accesos.js";
import { contarPedidos } from "./soporte/red.js";
import { Reportes } from "./soporte/reportes.js";

/**
 * E2E de HU-25 — Reportes de movimientos en PDF (SCRUM-37 / SCRUM-151).
 *
 * Lo que agrega sobre lo que ya esta cubierto en otro lado:
 *
 * - `Backend/tests/reportes.test.js` arma cada PDF en proceso y lee su texto:
 *   filtros, totales, tildes, paginado, tope de 5000 filas.
 * - Los unitarios del Frontend dibujan la tarjeta con el service mockeado y
 *   verifican la query que arma cada tipo.
 *
 * Aca se recorre el camino que ninguno de los dos ve: el navegador real pide el
 * PDF con la cookie de sesion, la respuesta cruza Nginx, la tarjeta lee el
 * nombre del archivo del header `Content-Disposition` y dispara la descarga con
 * un `<a download>`. Y el archivo que baja se ABRE: tiene que traer el comercio
 * de la sesion, la fecha de generacion, el tipo, el rango y solo los
 * movimientos que el filtro deja pasar. Son los tres criterios de aceptacion.
 *
 * Los movimientos se registran por el flujo real de HU-13 (ver
 * `tests/soporte/reportes.js`), asi que caen "hoy". Por eso los tests de datos
 * usan el rango que la tarjeta trae por defecto —del 1° del mes a hoy— y le
 * preguntan al formulario que dias tiene, en vez de calcularlos en Node: el que
 * convierte esos dias a instantes es el navegador, con su `timezoneId`.
 *
 * ---------------------------------------------------------------------------
 * QUE NO SE PRUEBA ACA, Y POR QUE
 *
 * - MONTOS. No existen en el sistema; el PDF lo aclara en una nota.
 * - El tope de 5000 movimientos. Harian falta 5001 movimientos creados de a uno
 *   contra Neon. Lo cubre `Backend/tests/reportes.test.js`, y el aviso
 *   `sugerencia-acotar-rango` los unitarios del Frontend.
 * - Productos o proveedores dados de baja: el selector lista solo activos, asi
 *   que desde la pantalla no se pueden elegir. El backend si los acepta (ver su
 *   suite).
 */

/** Gerente del comercio del test, con su propia pagina. */
async function abrirComoGerente({ playwright, api, browser }) {
  const gerente = await sumarMiembro(playwright, api, { rol: "gerente" });
  return abrirComo(browser, gerente.storageState);
}

test.describe("HU-25 — Reportes de movimientos en PDF", () => {
  test("el gerente llega desde el menú y descarga el reporte por período con comercio, fecha de generación, tipo, rango y todos los movimientos", async ({
    api,
    playwright,
    browser,
  }) => {
    const { comercio, yerba, azucar } = await escenarioDeReporte(api);
    const { context, page } = await abrirComoGerente({ playwright, api, browser });

    try {
      // Por el camino de la UI: el link «Reportes» de la navegación.
      const accesos = new Accesos(page);
      await accesos.irAInicio();

      const reportes = new Reportes(page);
      await reportes.acceso.click();
      await expect(page).toHaveURL(/\/reportes$/);
      await expect(reportes.titulo).toBeVisible();
      await expect(reportes.encabezado).toBeVisible();

      // El tipo por defecto es «Por período», y el rango, del 1° del mes a hoy.
      await expect(reportes.tipo("Por período")).toBeChecked();
      const rango = await reportes.rango();

      const pedidos = contarPedidos(page, RUTA_REPORTE, "GET");
      const descarga = await reportes.generarYDescargar();

      // El nombre sale del `Content-Disposition` del backend. Si Nginx se lo
      // comiera, o si CORS no lo expusiera, la tarjeta usaria el de respaldo
      // («reporte-movimientos.pdf») y esto fallaria.
      const nombre = nombreDeArchivoEsperado({ tipo: "periodo", ...rango });
      expect(descarga.suggestedFilename()).toBe(nombre);
      await expect(reportes.descargado).toHaveText(`Reporte descargado: ${nombre}`);
      await expect(reportes.alerta).toHaveCount(0);

      // La query: el tipo y el rango, sin ningun id de producto ni proveedor.
      expect(pedidos).toHaveLength(1);
      const query = new URL(pedidos[0]).searchParams;
      expect(query.get("tipo")).toBe("periodo");
      expect(query.has("productoId")).toBe(false);
      expect(query.has("proveedorId")).toBe(false);

      const { texto } = await Reportes.leerDescarga(descarga);

      // Criterio 3: fecha de generación, comercio y rango aplicado.
      expect(texto).toContain(comercio);
      expect(texto).toMatch(/Fecha de generación: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
      expect(texto).toContain("Reporte de movimientos por período");
      expect(texto).toContain("Tipo de reporte: Por período");
      expect(texto).toContain(`Rango aplicado: ${rangoComoEnPdf(rango)}`);

      // Criterio 2: los datos. Por período entran los tres movimientos.
      expect(texto).toContain(yerba.nombre);
      expect(texto).toContain(azucar.nombre);
      expect(texto).toContain("Movimientos: 3");
      expect(texto).toContain("Unidades que entraron: 10");
      expect(texto).toContain("Unidades que salieron: 2");
    } finally {
      await context.close();
    }
  });

  test("el gerente descarga el reporte por producto y trae solo los movimientos de ese producto", async ({
    api,
    playwright,
    browser,
  }) => {
    const { comercio, yerba, azucar, ingenio } = await escenarioDeReporte(api);
    const { context, page } = await abrirComoGerente({ playwright, api, browser });

    try {
      const reportes = new Reportes(page);
      await reportes.ir();

      await reportes.tipo("Por producto").check();
      await reportes.elegir(reportes.producto, yerba.id);
      const rango = await reportes.rango();

      const pedidos = contarPedidos(page, RUTA_REPORTE, "GET");
      const descarga = await reportes.generarYDescargar();

      const nombre = nombreDeArchivoEsperado({
        tipo: "producto",
        sujeto: yerba.nombre,
        ...rango,
      });
      expect(descarga.suggestedFilename()).toBe(nombre);
      await expect(reportes.descargado).toHaveText(`Reporte descargado: ${nombre}`);

      // Viaja el producto elegido y no un proveedor: el backend responde 400
      // si llega un id que el tipo no usa.
      expect(pedidos).toHaveLength(1);
      const query = new URL(pedidos[0]).searchParams;
      expect(query.get("tipo")).toBe("producto");
      expect(query.get("productoId")).toBe(yerba.id);
      expect(query.has("proveedorId")).toBe(false);

      const { texto } = await Reportes.leerDescarga(descarga);

      expect(texto).toContain(comercio);
      expect(texto).toContain("Tipo de reporte: Por producto");
      expect(texto).toContain(`Producto: ${yerba.nombre}`);
      expect(texto).toContain(`Rango aplicado: ${rangoComoEnPdf(rango)}`);

      // Los dos movimientos de la yerba —la compra y la venta— y nada del
      // azucar: ni el producto ni el proveedor al que se le compro.
      expect(texto).toContain("Movimientos: 2");
      expect(texto).toContain("Compras: 1 movimiento, +7 unidades");
      expect(texto).toContain("Ventas: 1 movimiento, -2 unidades");
      expect(texto).not.toContain(azucar.nombre);
      expect(texto).not.toContain(ingenio.nombre);
    } finally {
      await context.close();
    }
  });

  test("el gerente descarga el reporte por proveedor y trae solo las compras a ese proveedor", async ({
    api,
    playwright,
    browser,
  }) => {
    const { comercio, yerba, azucar, yerbatera, ingenio } =
      await escenarioDeReporte(api);
    const { context, page } = await abrirComoGerente({ playwright, api, browser });

    try {
      const reportes = new Reportes(page);
      await reportes.ir();

      await reportes.tipo("Por proveedor").check();
      await reportes.elegir(reportes.proveedor, yerbatera.id);
      const rango = await reportes.rango();

      const pedidos = contarPedidos(page, RUTA_REPORTE, "GET");
      const descarga = await reportes.generarYDescargar();

      const nombre = nombreDeArchivoEsperado({
        tipo: "proveedor",
        sujeto: yerbatera.nombre,
        ...rango,
      });
      expect(descarga.suggestedFilename()).toBe(nombre);
      await expect(reportes.descargado).toHaveText(`Reporte descargado: ${nombre}`);

      expect(pedidos).toHaveLength(1);
      const query = new URL(pedidos[0]).searchParams;
      expect(query.get("tipo")).toBe("proveedor");
      expect(query.get("proveedorId")).toBe(yerbatera.id);
      expect(query.has("productoId")).toBe(false);

      const { texto } = await Reportes.leerDescarga(descarga);

      expect(texto).toContain(comercio);
      expect(texto).toContain("Tipo de reporte: Por proveedor");
      expect(texto).toContain(`Proveedor: ${yerbatera.nombre}`);
      expect(texto).toContain(`Rango aplicado: ${rangoComoEnPdf(rango)}`);

      // Solo la compra de yerba a la Yerbatera. La venta de yerba no tiene
      // proveedor, asi que no entra; y el azucar se le compro a otro.
      expect(texto).toContain(yerba.nombre);
      expect(texto).toContain("Movimientos: 1");
      expect(texto).toContain("Compras: 1 movimiento, +7 unidades");
      expect(texto).not.toContain("Venta");
      expect(texto).not.toContain(azucar.nombre);
      expect(texto).not.toContain(ingenio.nombre);
    } finally {
      await context.close();
    }
  });

  test("un rango sin movimientos descarga igual el PDF, que lo dice", async ({
    page,
    api,
  }) => {
    // Con la sesion del propietario, el otro rol que tiene `reporte:generar`.
    const comercio = `Almacén Vacío ${Date.now() % 100000}`;
    await ponerNombreAlComercio(api, comercio);

    const reportes = new Reportes(page);
    await reportes.ir();

    await reportes.hasta.fill(RANGO_SIN_MOVIMIENTOS.dias.hasta);
    await reportes.desde.fill(RANGO_SIN_MOVIMIENTOS.dias.desde);

    const descarga = await reportes.generarYDescargar();

    // No es un error: no hay ningun aviso, y el archivo baja como cualquier otro.
    const nombre = nombreDeArchivoEsperado({
      tipo: "periodo",
      ...RANGO_SIN_MOVIMIENTOS.dias,
    });
    expect(descarga.suggestedFilename()).toBe(nombre);
    await expect(reportes.descargado).toHaveText(`Reporte descargado: ${nombre}`);
    await expect(reportes.alerta).toHaveCount(0);

    const { texto } = await Reportes.leerDescarga(descarga);

    expect(texto).toContain(comercio);
    expect(texto).toContain(MENSAJE_SIN_MOVIMIENTOS);
    expect(texto).toContain(`Rango aplicado: ${RANGO_SIN_MOVIMIENTOS.enPdf}`);
    expect(texto).toContain("Movimientos: 0");
  });

  test("con «Desde» posterior a «Hasta» avisa al lado del campo y no pide nada al backend", async ({
    page,
  }) => {
    const reportes = new Reportes(page);
    await reportes.ir();

    const pedidos = contarPedidos(page, RUTA_REPORTE, "GET");

    // «Hasta» primero: tocar una fecha borra el aviso de rango, asi que el
    // orden deja el formulario en el estado invertido justo antes del clic.
    await reportes.hasta.fill("2026-02-01");
    await reportes.desde.fill("2026-02-10");
    await reportes.generar.click();

    await expect(reportes.errorDesde).toHaveText(Reportes.RANGO_INVERTIDO);
    await expect(reportes.desde).toHaveAttribute("aria-invalid", "true");
    await expect(reportes.descargado).toHaveCount(0);

    // Sin contar los pedidos este test pasaria aunque la validacion no
    // existiera: el backend contesta 400 con un mensaje parecido y la tarjeta
    // lo mostraria igual, en otro lugar.
    expect(pedidos).toHaveLength(0);
  });

  test("el empleado no ve «Reportes» en el menú y entrando por URL ve el cartel de sin permiso", async ({
    api,
    playwright,
    browser,
  }) => {
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const { context, page } = await abrirComo(browser, empleado.storageState);

    try {
      // `irAInicio` espera a que los permisos hayan llegado: antes de eso la
      // navegacion no muestra NINGUN acceso que dependa del rol, asi que un
      // `toHaveCount(0)` pasaria aunque el empleado lo fuera a ver.
      const accesos = new Accesos(page);
      await accesos.irAInicio();

      const reportes = new Reportes(page);
      await expect(reportes.acceso).toHaveCount(0);
      // El contraste, en el mismo panel: Proveedores si lo ve (`proveedor:read`
      // lo tienen los tres roles). Sin esto, el acceso podria faltar porque el
      // panel entero no se dibujo.
      await expect(page.getByTestId("acceso-proveedores")).toBeVisible();

      const pedidos = contarPedidos(page, RUTA_REPORTE, "GET");

      await page.goto("/reportes");
      await expect(reportes.sinPermiso).toBeVisible();
      await expect(reportes.tarjeta).toHaveCount(0);
      expect(pedidos).toHaveLength(0);
    } finally {
      await context.close();
    }
  });
});

test.describe("HU-25 — Reportes en el celular", () => {
  test("el gerente llega a Reportes desde «Más» y descarga el reporte sin scroll horizontal", async ({
    api,
    playwright,
    browser,
  }) => {
    const { comercio } = await escenarioDeReporte(api);
    const { context, page } = await abrirComoGerente({ playwright, api, browser });

    try {
      // 375 px: el ancho de un iPhone SE/mini, el más angosto que se soporta.
      // Por debajo de `lg` la navegación es la barra de abajo, y «Reportes»
      // vive en el panel «Más».
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/");

      const reportes = new Reportes(page);
      await expect(reportes.botonMas).toBeVisible();
      await expect(reportes.acceso).toBeHidden();

      await reportes.botonMas.click();
      await reportes.acceso.click();

      await expect(page).toHaveURL(/\/reportes$/);
      await expect(reportes.tarjeta).toBeVisible();

      // Nada se sale de la pantalla: ni la tarjeta con sus tres píldoras ni las
      // dos fechas.
      const anchos = await page.evaluate(() => ({
        documento: document.documentElement.scrollWidth,
        ventana: document.documentElement.clientWidth,
      }));
      expect(
        anchos.documento,
        `la página mide ${anchos.documento}px en una ventana de ${anchos.ventana}px`,
      ).toBeLessThanOrEqual(anchos.ventana);

      const rango = await reportes.rango();
      const descarga = await reportes.generarYDescargar();

      const nombre = nombreDeArchivoEsperado({ tipo: "periodo", ...rango });
      expect(descarga.suggestedFilename()).toBe(nombre);
      await expect(reportes.descargado).toHaveText(`Reporte descargado: ${nombre}`);

      const { texto } = await Reportes.leerDescarga(descarga);
      expect(texto).toContain(comercio);
      expect(texto).toContain("Movimientos: 3");
    } finally {
      await context.close();
    }
  });
});
