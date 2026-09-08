import { expect, test } from "../soporte/fixtures.js";
import { PASSWORD } from "../soporte/entorno.js";
import { Login } from "./soporte/login.js";

/**
 * E2E de HU-2 — inicio de sesion real por la interfaz.
 *
 * Es el hueco que dejaba el resto de la suite: todas las demas suites arrancan
 * con la sesion ya puesta en el `storageState` del fixture `comercio`, que la
 * obtiene por API. Ninguna pasaba por el formulario de `/login`, o sea que la
 * pantalla central de la HU no se tocaba de punta a punta.
 *
 * Lo que agrega sobre `Frontend/src/pages/Login.test.jsx`, que ya prueba el
 * formulario con Vitest: ahi el service esta mockeado. Aca la cookie la emite
 * Better Auth de verdad, viaja por Nginx, y `RutaProtegida` la lee del store
 * real. Eso es justo lo que se rompio una vez —habia que apretar "Entrar" dos
 * veces porque el store todavia no reflejaba la sesion— y es un bug que ningun
 * test de un repo suelto podia ver.
 *
 * Se usa el fixture `comercio` solo para tener una cuenta que ya existe; la
 * sesion que trae se descarta con `storageState: undefined`, porque estos tests
 * vienen justamente a crearla desde cero.
 */
test.use({ storageState: undefined });

test.describe("HU-2 — Inicio de sesión", () => {
  test("con credenciales correctas entra y queda con sesión", async ({
    page,
    comercio,
  }) => {
    const login = new Login(page);
    await login.ir();
    await login.entrar({ correo: comercio.email, password: PASSWORD });

    // Una sola vez. El bug del doble clic se veia exactamente asi: el primer
    // "Entrar" respondia bien pero `RutaProtegida` leia el store viejo y
    // rebotaba de vuelta al formulario.
    await expect(login.saludo).toBeVisible();
    await expect(login.error).toHaveCount(0);
  });

  test("la sesión sobrevive a recargar la página", async ({
    page,
    comercio,
  }) => {
    // Es un criterio de la HU y solo se puede probar acá: la cookie es
    // HttpOnly, así que lo que la sostiene es el navegador más el backend, no
    // nada que el Frontend guarde por su cuenta.
    const login = new Login(page);
    await login.ir();
    await login.entrar({ correo: comercio.email, password: PASSWORD });
    await expect(login.saludo).toBeVisible();

    await page.reload();

    await expect(login.saludo).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("con la contraseña equivocada no entra y lo dice", async ({
    page,
    comercio,
  }) => {
    const login = new Login(page);
    await login.ir();
    await login.entrar({ correo: comercio.email, password: "noEsLaClave123" });

    await expect(login.error).toBeVisible();
    await expect(login.saludo).toHaveCount(0);
    await expect(page).toHaveURL(/\/login/);
  });

  test("un correo que no existe da el mismo mensaje que una clave mal", async ({
    page,
    comercio,
  }) => {
    // El backend responde igual en los dos casos para que no se pueda averiguar
    // qué correos están registrados probando de a uno. Si la pantalla los
    // distinguiera, ese cuidado no serviría de nada.
    const login = new Login(page);

    await login.ir();
    await login.entrar({ correo: comercio.email, password: "noEsLaClave123" });
    const conClaveMal = await login.error.textContent();

    await login.ir();
    await login.entrar({
      correo: "nadie-con-esta-cuenta@test.local",
      password: PASSWORD,
    });
    const conCorreoInexistente = await login.error.textContent();

    expect(conCorreoInexistente).toBe(conClaveMal);
  });

  test("sin sesión, una pantalla protegida manda al login", async ({ page }) => {
    await page.goto("/configuracion");

    await expect(page).toHaveURL(/\/login/);
    await expect(new Login(page).encabezado).toBeVisible();
  });

  test("cerrar sesión deja la pantalla protegida inalcanzable", async ({
    page,
    comercio,
  }) => {
    const login = new Login(page);
    await login.ir();
    await login.entrar({ correo: comercio.email, password: PASSWORD });
    await expect(login.saludo).toBeVisible();

    await login.botonSalir.click();
    await expect(login.encabezado).toBeVisible();

    // Volver a entrar a mano tampoco: la cookie se invalidó del lado del
    // servidor, no solo se ocultó la pantalla.
    await page.goto("/configuracion");
    await expect(page).toHaveURL(/\/login/);
  });

  test("desde el login se llega a recuperar la contraseña (HU-3)", async ({
    page,
  }) => {
    const login = new Login(page);
    await login.ir();
    await login.enlaceOlvido.click();

    await expect(
      page.getByRole("heading", { name: "Recuperar contraseña" }),
    ).toBeVisible();
  });
});
