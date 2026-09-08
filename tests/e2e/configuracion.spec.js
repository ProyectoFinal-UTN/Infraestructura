import { expect, test } from "../soporte/fixtures.js";
import { Configuracion } from "./soporte/configuracion.js";
import { leerUbicaciones } from "../soporte/datos.js";

/**
 * E2E de HU-8 — ubicaciones de stock y moneda, por la pantalla.
 *
 * La suite ya tocaba HU-8 de refilon: `detalle-producto.spec.js` verifica que
 * sin ubicaciones la app deriva a Configuracion, y varios tests crean
 * ubicaciones por API como andamiaje. Pero la pantalla en si —alta, renombrar,
 * eliminar, cambiar moneda— no se probaba por UI.
 *
 * El criterio "el cambio se refleja en el resto del sistema" es el que solo se
 * puede verificar acá: se comprueba contra la API, que es lo que van a leer las
 * demas pantallas, y no contra el estado del propio componente.
 */
test.describe("HU-8 — Ubicaciones y moneda", () => {
  test("un comercio nuevo arranca sin ubicaciones", async ({ page }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("ubicaciones");

    await expect(configuracion.ubicaciones.vacio).toBeVisible();
  });

  test("la ubicación que se crea queda guardada de verdad", async ({
    page,
    api,
  }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("ubicaciones");

    await configuracion.agregarUbicacion("Depósito");
    await expect(configuracion.filaUbicacion("Depósito")).toBeVisible();

    // Contra la API, que es lo que van a leer las demas pantallas. Si solo se
    // mirara la lista, un componente que agrega la fila sin postear pasaria.
    const guardadas = await leerUbicaciones(api);
    expect(guardadas.map((u) => u.nombre)).toContain("Depósito");
  });

  test("un nombre repetido se rechaza con el mensaje del backend", async ({
    page,
  }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("ubicaciones");

    await configuracion.agregarUbicacion("Local");
    await expect(configuracion.filaUbicacion("Local")).toBeVisible();

    await configuracion.agregarUbicacion("Local");

    await expect(configuracion.ubicaciones.error).toBeVisible();
    await expect(configuracion.ubicaciones.error).toContainText(/ya existe/i);
    // Y no quedaron dos.
    await expect(configuracion.filaUbicacion("Local")).toHaveCount(1);
  });

  test("un nombre vacío ni siquiera sale al backend", async ({ page }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("ubicaciones");

    const huboPedido = page
      .waitForRequest(
        (pedido) =>
          pedido.url().includes("/api/ubicaciones") &&
          pedido.method() === "POST",
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);

    await configuracion.ubicaciones.agregar.click();

    expect(await huboPedido).toBe(false);
    await expect(configuracion.ubicaciones.error).toBeVisible();
  });

  test("renombrar cambia el nombre en la base", async ({ page, api }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("ubicaciones");

    await configuracion.agregarUbicacion("Estante");
    await expect(configuracion.filaUbicacion("Estante")).toBeVisible();

    await page.getByRole("button", { name: "Renombrar Estante" }).click();
    await page.getByLabel("Nuevo nombre de Estante").fill("Estante grande");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(configuracion.filaUbicacion("Estante grande")).toBeVisible();

    const guardadas = await leerUbicaciones(api);
    expect(guardadas.map((u) => u.nombre)).toContain("Estante grande");
    expect(guardadas.map((u) => u.nombre)).not.toContain("Estante");
  });

  test("eliminar pide confirmación y recién ahí borra", async ({
    page,
    api,
  }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("ubicaciones");

    await configuracion.agregarUbicacion("Transitoria");
    await expect(configuracion.filaUbicacion("Transitoria")).toBeVisible();

    await page.getByRole("button", { name: "Eliminar Transitoria" }).click();

    // Con la confirmación a la vista, todavía no se borró nada.
    await expect(page.getByText("¿Eliminar «Transitoria»?")).toBeVisible();
    expect((await leerUbicaciones(api)).map((u) => u.nombre)).toContain(
      "Transitoria",
    );

    await page.getByRole("button", { name: "Sí, eliminar" }).click();

    await expect(configuracion.filaUbicacion("Transitoria")).toHaveCount(0);
    expect((await leerUbicaciones(api)).map((u) => u.nombre)).not.toContain(
      "Transitoria",
    );
  });

  test("cancelar la eliminación no borra nada", async ({ page, api }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("ubicaciones");

    await configuracion.agregarUbicacion("Se queda");
    await expect(configuracion.filaUbicacion("Se queda")).toBeVisible();

    await page.getByRole("button", { name: "Eliminar Se queda" }).click();
    await page.getByRole("button", { name: "Cancelar" }).click();

    await expect(configuracion.filaUbicacion("Se queda")).toBeVisible();
    expect((await leerUbicaciones(api)).map((u) => u.nombre)).toContain(
      "Se queda",
    );
  });

  test("la moneda que se elige queda puesta para todo el comercio", async ({
    page,
    api,
  }) => {
    // Es el segundo criterio de la HU: "se refleja en el resto del sistema".
    // Por eso se verifica contra `GET /api/configuracion`, que es de donde lo
    // van a sacar las demas pantallas, y no contra el `<select>`.
    const configuracion = new Configuracion(page);
    await configuracion.ir("ubicaciones");

    await expect(configuracion.ubicaciones.moneda).toHaveValue("ARS");

    await configuracion.ubicaciones.moneda.selectOption("USD");

    await expect(configuracion.ubicaciones.moneda).toHaveValue("USD");

    const respuesta = await api.get("/api/configuracion");
    expect(respuesta.status()).toBe(200);
    expect((await respuesta.json()).moneda).toBe("USD");

    // Y sobrevive a recargar.
    await configuracion.ir("ubicaciones");
    await expect(configuracion.ubicaciones.moneda).toHaveValue("USD");
  });
});
