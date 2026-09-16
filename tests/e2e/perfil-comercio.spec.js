import { expect, test } from "../soporte/fixtures.js";
import { Configuracion } from "./soporte/configuracion.js";

/**
 * E2E de HU-6 — datos del negocio.
 *
 * Los dos criterios de la HU: que se puedan cargar y que los obligatorios se
 * exijan. Lo que agrega sobre `Frontend/src/components/SeccionPerfil.test.jsx`
 * es la vuelta completa: el dato se guarda en Neon y se vuelve a leer en una
 * pagina nueva. Con el service mockeado eso no se puede distinguir de un
 * formulario que solo actualiza su propio estado.
 */
test.describe("HU-6 — Perfil del comercio", () => {
  test("los datos cargados quedan guardados y se ven al volver", async ({
    page,
  }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("perfil");

    // El comercio nace del registro con el nombre por defecto.
    await expect(configuracion.perfil.nombre).toHaveValue("Mi comercio");

    await configuracion.perfil.nombre.fill("Kiosco Don Pepe");
    await configuracion.perfil.rubro.fill("Kiosco");
    await configuracion.perfil.direccion.fill("Av. Siempreviva 742");
    await configuracion.perfil.telefono.fill("351 123 4567");
    await configuracion.perfil.correoContacto.fill("contacto@donpepe.test");
    await configuracion.perfil.guardar.click();

    await expect(configuracion.perfil.guardado).toBeVisible();

    // La prueba de verdad: una carga nueva de la pantalla, que vuelve a pedirle
    // los datos al backend.
    await configuracion.ir("perfil");

    await expect(configuracion.perfil.nombre).toHaveValue("Kiosco Don Pepe");
    await expect(configuracion.perfil.rubro).toHaveValue("Kiosco");
    await expect(configuracion.perfil.direccion).toHaveValue(
      "Av. Siempreviva 742",
    );
    await expect(configuracion.perfil.telefono).toHaveValue("351 123 4567");
    await expect(configuracion.perfil.correoContacto).toHaveValue(
      "contacto@donpepe.test",
    );
  });

  test("sin nombre no guarda y no llega al backend", async ({ page }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("perfil");

    await configuracion.perfil.nombre.fill("");
    await configuracion.perfil.rubro.fill("Kiosco");

    // Si el pedido saliera, este `waitForRequest` lo veria. Se le da una ventana
    // corta y se espera que venza: la validacion corta antes.
    const huboPedido = page
      .waitForRequest(
        (pedido) =>
          pedido.url().includes("/api/comercio") && pedido.method() === "PUT",
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);

    await configuracion.perfil.guardar.click();

    expect(await huboPedido).toBe(false);
    await expect(configuracion.perfil.guardado).toHaveCount(0);
  });

  test("los opcionales pueden quedar vacíos", async ({ page }) => {
    // El backend los guarda como `null`, y al volver el input tiene que quedar
    // vacio y no con la cadena "null" —que es como se rompe si alguien saca la
    // normalizacion de `aFormulario`—.
    const configuracion = new Configuracion(page);
    await configuracion.ir("perfil");

    await configuracion.perfil.nombre.fill("Almacén sin datos");
    await configuracion.perfil.rubro.fill("Almacén");
    await configuracion.perfil.direccion.fill("");
    await configuracion.perfil.telefono.fill("");
    await configuracion.perfil.correoContacto.fill("");
    await configuracion.perfil.guardar.click();

    await expect(configuracion.perfil.guardado).toBeVisible();

    await configuracion.ir("perfil");

    await expect(configuracion.perfil.nombre).toHaveValue("Almacén sin datos");
    await expect(configuracion.perfil.direccion).toHaveValue("");
    await expect(configuracion.perfil.telefono).toHaveValue("");
    await expect(configuracion.perfil.correoContacto).toHaveValue("");
  });

  test("se llega desde el inicio, sin escribir la URL a mano", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Configuración" }).click();

    const configuracion = new Configuracion(page);
    await expect(configuracion.titulo).toBeVisible();
    // Abre en Perfil, que es la primera pestana.
    await expect(configuracion.perfil.nombre).toBeVisible();
  });
});
