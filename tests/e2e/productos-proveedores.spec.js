import { expect, test } from "../soporte/fixtures.js";
import {
  asociarProveedorViaApi,
  crearProductoViaApi,
  crearProveedorViaApi,
  leerMovimientos,
  leerProveedoresDeProducto,
} from "../soporte/datos.js";
import { abrirComo, sumarMiembro } from "../soporte/equipo.js";
import { DetalleProducto } from "./soporte/detalleProducto.js";
import { Movimientos } from "./soporte/movimientos.js";
import { Proveedores } from "./soporte/proveedores.js";
import { Recomendaciones } from "./soporte/recomendaciones.js";

/**
 * E2E de HU-20 (SCRUM-32) — asociación de productos a proveedores.
 * Subtarea de testing SCRUM-139.
 *
 * Los dos criterios de la HU, por pantalla:
 *
 * 1. Un producto puede asociarse a uno o varios proveedores: desde la ficha del
 *    producto, y visto también desde el proveedor.
 * 2. Al generar una alerta de reposición se sugiere el proveedor asociado: hoy
 *    la alerta de reposición es la tarjeta `reponer` del Inicio (HU-27).
 *
 * Más el uso que le da sentido al vínculo: al registrar una compra, los
 * proveedores del producto se ofrecen primero.
 *
 * Que NO se prueba acá: el duplicado (409), el aislamiento entre comercios y
 * los ids inválidos. Eso lo cubre Backend/tests/productoProveedor.test.js.
 */

/** La sección «Proveedores» de la ficha del producto (`<section>` con título). */
function seccionProveedores(page) {
  return page.getByRole("region", { name: "Proveedores" });
}

test.describe("HU-20 — Productos y proveedores", () => {
  test("un producto se asocia a varios proveedores desde su ficha, y se ve desde el proveedor", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api);
    const sur = await crearProveedorViaApi(api);
    const norte = await crearProveedorViaApi(api);

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();
    const seccion = seccionProveedores(page);
    await expect(
      seccion.getByText("Este producto todavía no tiene proveedores asociados."),
    ).toBeVisible();

    for (const proveedor of [sur, norte]) {
      await seccion.getByLabel("Agregar proveedor").selectOption({ label: proveedor.nombre });
      await seccion.getByRole("button", { name: "Asociar" }).click();
      await expect(seccion.getByRole("listitem").filter({ hasText: proveedor.nombre })).toBeVisible();
    }

    // El desplegable ya no ofrece ninguno: los dos del comercio están asociados.
    await expect(seccion.getByLabel("Agregar proveedor")).toHaveCount(0);

    const guardados = await leerProveedoresDeProducto(api, producto.id);
    expect(guardados.map((p) => p.id).sort()).toEqual([sur.id, norte.id].sort());

    // El mismo vínculo, del lado del proveedor.
    const proveedores = new Proveedores(page);
    await proveedores.ir();
    await proveedores
      .fila(sur.nombre)
      .getByRole("button", { name: `Productos de ${sur.nombre}` })
      .click();
    await expect(
      proveedores.fila(sur.nombre).getByRole("link", { name: producto.nombre }),
    ).toHaveAttribute("href", `/productos/${producto.id}`);
  });

  test("se quita un proveedor del producto sin borrar el proveedor", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api);
    const proveedor = await crearProveedorViaApi(api);
    await asociarProveedorViaApi(api, producto.id, proveedor.id);

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();
    const seccion = seccionProveedores(page);
    await seccion.getByRole("button", { name: `Quitar ${proveedor.nombre}` }).click();

    await expect(
      seccion.getByText("Este producto todavía no tiene proveedores asociados."),
    ).toBeVisible();
    expect(await leerProveedoresDeProducto(api, producto.id)).toEqual([]);
    // Lo que se borró es el vínculo: el proveedor sigue en el directorio.
    expect((await api.get(`/api/proveedores/${proveedor.id}`)).status()).toBe(200);
  });

  test("al registrar una compra, los proveedores del producto se ofrecen primero y se guarda el elegido", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api);
    const otro = await crearProveedorViaApi(api);
    const suyo = await crearProveedorViaApi(api);
    await asociarProveedorViaApi(api, producto.id, suyo.id);

    const movimientos = new Movimientos(page);
    await movimientos.ir();
    await movimientos.completar({ producto: producto.nombre, tipo: "compra", cantidad: 6 });

    const campo = movimientos.formulario.getByLabel("Proveedor (opcional)");
    // Ningún proveedor viene elegido de antemano.
    await expect(campo).toHaveValue("");
    const sugeridos = campo.locator('optgroup[label="Le comprás este producto a"] option');
    await expect(sugeridos).toHaveText([suyo.nombre]);
    await expect(
      campo.locator('optgroup[label="Otros proveedores"] option'),
    ).toHaveText([otro.nombre]);

    await campo.selectOption({ label: suyo.nombre });
    await movimientos.registrar();
    await expect(movimientos.confirmacion).toBeVisible();

    const [compra] = await leerMovimientos(api, producto.id);
    expect(compra).toMatchObject({ tipo: "compra", cantidad: 6, proveedorId: suyo.id });
  });

  test("en una venta no se pide proveedor", async ({ page, api }) => {
    const producto = await crearProductoViaApi(api);
    await crearProveedorViaApi(api);

    const movimientos = new Movimientos(page);
    await movimientos.ir();
    await movimientos.completar({ producto: producto.nombre, tipo: "venta" });

    await expect(movimientos.formulario.getByLabel("Proveedor (opcional)")).toHaveCount(0);
  });

  test("la alerta de reposición sugiere a quién pedirle", async ({ page, api }) => {
    // Sin stock y con mínimo: sale como `reponer` en las sugerencias del Inicio.
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5", stockActual: "0" });
    const proveedor = await crearProveedorViaApi(api, { telefono: "11 5555-0000" });
    await asociarProveedorViaApi(api, producto.id, proveedor.id);

    const recomendaciones = new Recomendaciones(page);
    await recomendaciones.ir();

    const tarjeta = recomendaciones.tarjeta("reponer");
    await expect(tarjeta).toContainText(producto.nombre);
    await expect(tarjeta).toContainText("Se lo podés pedir a:");
    await expect(tarjeta).toContainText(proveedor.nombre);
    await expect(tarjeta.getByRole("link", { name: "11 5555-0000" })).toHaveAttribute(
      "href",
      "tel:1155550000",
    );
  });

  test("el empleado ve los proveedores del producto, pero no los modifica", async ({
    api,
    playwright,
    browser,
  }) => {
    const producto = await crearProductoViaApi(api);
    const proveedor = await crearProveedorViaApi(api);
    await crearProveedorViaApi(api);
    await asociarProveedorViaApi(api, producto.id, proveedor.id);
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const { context, page } = await abrirComo(browser, empleado.storageState);

    try {
      const detalle = new DetalleProducto(page, producto);
      await detalle.ir();
      const seccion = seccionProveedores(page);

      await expect(seccion.getByText(proveedor.nombre)).toBeVisible();
      await expect(seccion.getByRole("button", { name: /^Quitar/ })).toHaveCount(0);
      await expect(seccion.getByLabel("Agregar proveedor")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
