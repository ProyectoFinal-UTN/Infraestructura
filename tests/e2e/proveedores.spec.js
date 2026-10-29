import { expect, test } from "../soporte/fixtures.js";
import {
  crearProductoViaApi,
  crearProveedorViaApi,
  registrarMovimientoViaApi,
} from "../soporte/datos.js";
import { abrirComo, sumarMiembro } from "../soporte/equipo.js";
import { Proveedores } from "./soporte/proveedores.js";

/**
 * E2E de HU-19 (SCRUM-31) — alta y gestión de proveedores.
 * Subtarea de testing SCRUM-136.
 *
 * Los criterios de la HU son dos: el formulario carga nombre, contacto, rubro y
 * condiciones de pago, y se pueden editar y eliminar. Se recorren por la
 * interfaz contra el stack completo.
 *
 * Que NO se prueba aca: las validaciones de la API una por una, el aislamiento
 * entre comercios ni la validacion del proveedor en un movimiento. Eso lo
 * cubre Backend/tests/proveedores.test.js. La API se usa como andamiaje y para
 * verificar lo que la pantalla no muestra.
 *
 * Cada test trae su propio comercio vacio, igual que el resto de la suite.
 */

test.describe("HU-19 — Proveedores", () => {
  test("se entra desde la navegación", async ({ page }) => {
    const proveedores = new Proveedores(page);

    await page.goto("/");
    await page.getByRole("link", { name: "Proveedores", exact: true }).click();

    await expect(page).toHaveURL(/\/proveedores$/);
    await expect(proveedores.titulo).toBeVisible();
    await expect(proveedores.listaVacia).toBeVisible();
  });

  test("da de alta un proveedor con nombre, contacto, rubro y condiciones de pago", async ({
    page,
    api,
  }) => {
    const proveedores = new Proveedores(page);
    await proveedores.ir();

    const datos = {
      nombre: `Distribuidora Sur ${Date.now() % 100000}`,
      contacto: "Laura Gómez",
      telefono: "11 5555-0000",
      correo: "ventas@distrisur.com",
      rubro: "Bebidas",
      condicionesPago: "30 días",
    };

    await proveedores.abrirAlta();
    await proveedores.completar(proveedores.formularioAlta, datos);
    await proveedores.guardar(proveedores.formularioAlta);

    await expect(proveedores.mensajeExito).toHaveText(
      `«${datos.nombre}» se agregó a tus proveedores.`,
    );
    await expect(proveedores.formularioAlta).toHaveCount(0);

    const fila = proveedores.fila(datos.nombre);
    await expect(fila).toContainText("Bebidas · 30 días");
    await expect(fila).toContainText("Laura Gómez");
    await expect(fila.getByRole("link", { name: "11 5555-0000" })).toHaveAttribute(
      "href",
      "tel:1155550000",
    );
    await expect(
      fila.getByRole("link", { name: "ventas@distrisur.com" }),
    ).toHaveAttribute("href", "mailto:ventas@distrisur.com");

    // Contraprueba contra el backend: lo que se ve es lo que se guardó.
    const lista = await (await api.get("/api/proveedores")).json();
    expect(lista).toEqual([expect.objectContaining(datos)]);
  });

  test("sin nombre no guarda, y un nombre repetido se marca en el campo", async ({
    page,
    api,
  }) => {
    const existente = await crearProveedorViaApi(api);
    const proveedores = new Proveedores(page);
    await proveedores.ir();

    await proveedores.abrirAlta();
    await proveedores.completar(proveedores.formularioAlta, { rubro: "Bebidas" });
    await proveedores.guardar(proveedores.formularioAlta);

    await expect(proveedores.errorDeCampo("nombre")).toHaveText(
      "Ingresá el nombre del proveedor.",
    );

    // Mismo nombre en mayúsculas: el backend no distingue y responde 409.
    await proveedores.completar(proveedores.formularioAlta, {
      nombre: existente.nombre.toUpperCase(),
    });
    await proveedores.guardar(proveedores.formularioAlta);

    await expect(proveedores.errorDeCampo("nombre")).toContainText("Ya existe");
    await expect(proveedores.formularioAlta).toBeVisible();

    const lista = await (await api.get("/api/proveedores")).json();
    expect(lista).toHaveLength(1);
  });

  test("edita un proveedor y borra un dato que ya no corresponde", async ({
    page,
    api,
  }) => {
    const proveedor = await crearProveedorViaApi(api, {
      telefono: "11 4444-1111",
      condicionesPago: "Contado",
    });
    const proveedores = new Proveedores(page);
    await proveedores.ir();

    await proveedores.botonEditar(proveedor.nombre).click();
    await expect(proveedores.formularioEdicion).toBeVisible();
    await proveedores.completar(proveedores.formularioEdicion, {
      telefono: "",
      condicionesPago: "30 días",
    });
    await proveedores.guardar(proveedores.formularioEdicion);

    await expect(proveedores.mensajeExito).toHaveText(
      `Se guardaron los cambios de «${proveedor.nombre}».`,
    );
    const fila = proveedores.fila(proveedor.nombre);
    await expect(fila).toContainText("30 días");
    await expect(fila.getByRole("link", { name: "11 4444-1111" })).toHaveCount(0);

    const guardado = await (await api.get(`/api/proveedores/${proveedor.id}`)).json();
    expect(guardado).toMatchObject({ telefono: null, condicionesPago: "30 días" });
  });

  test("elimina con confirmación y las compras siguen en el historial", async ({
    page,
    api,
  }) => {
    const proveedor = await crearProveedorViaApi(api);
    const producto = await crearProductoViaApi(api);
    const { movimiento: compra } = await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      tipo: "compra",
      cantidad: 5,
      proveedorId: proveedor.id,
    });

    const proveedores = new Proveedores(page);
    await proveedores.ir();

    // Cancelar no borra.
    await proveedores.botonEliminar(proveedor.nombre).click();
    await expect(proveedores.confirmacion(proveedor.nombre)).toContainText(
      "siguen en el historial",
    );
    await proveedores
      .confirmacion(proveedor.nombre)
      .getByRole("button", { name: "Cancelar" })
      .click();
    await expect(proveedores.fila(proveedor.nombre)).toBeVisible();

    await proveedores.botonEliminar(proveedor.nombre).click();
    await proveedores
      .confirmacion(proveedor.nombre)
      .getByRole("button", { name: "Sí, eliminar" })
      .click();

    await expect(proveedores.listaVacia).toBeVisible();

    // La baja es lógica: la compra conserva a quién se le compró.
    const historial = await (
      await api.get(`/api/movimientos?proveedorId=${proveedor.id}`)
    ).json();
    expect(historial.movimientos.map((m) => m.id)).toEqual([compra.id]);
  });

  /**
   * El destino de este link CAMBIO con HU-21: antes iba a
   * `/movimientos?proveedorId=...`, el historial general filtrado, que mezcla
   * los cinco tipos de movimiento y no resume nada. Ahora va a la pantalla de
   * compras del proveedor.
   *
   * Lo que a HU-19 le toca verificar es que el boton de la fila lleve a la
   * pantalla de ESE proveedor, y nada mas. Lo que se ve al llegar —encabezado,
   * resumen, filas, filtros— es de HU-21 y se prueba en
   * `historial-compras-proveedor.spec.js`, que ademas entra por este mismo link.
   */
  test("«Ver compras» lleva al historial de compras de ese proveedor", async ({
    page,
    api,
  }) => {
    const proveedor = await crearProveedorViaApi(api);
    const proveedores = new Proveedores(page);
    await proveedores.ir();

    await page
      .getByRole("link", { name: `Ver compras a ${proveedor.nombre}`, exact: true })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/proveedores/${proveedor.id}/compras$`),
    );
  });

  test("el empleado consulta los proveedores pero no los modifica", async ({
    api,
    playwright,
    browser,
  }) => {
    const proveedor = await crearProveedorViaApi(api, { rubro: "Limpieza" });
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const { context, page } = await abrirComo(browser, empleado.storageState);

    try {
      const proveedores = new Proveedores(page);
      await proveedores.ir();

      await expect(proveedores.soloLectura).toBeVisible();
      await expect(proveedores.fila(proveedor.nombre)).toContainText("Limpieza");
      await expect(proveedores.botonNuevo).toHaveCount(0);
      await expect(proveedores.botonEditar(proveedor.nombre)).toHaveCount(0);
      await expect(proveedores.botonEliminar(proveedor.nombre)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
