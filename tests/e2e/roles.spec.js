import { expect, test } from "../soporte/fixtures.js";
import { Configuracion } from "./soporte/configuracion.js";
import { Login } from "./soporte/login.js";
import { abrirComo, sumarMiembro } from "../soporte/equipo.js";

/**
 * E2E de HU-4 — roles y permisos, con dos personas en el mismo comercio.
 *
 * Es la unica suite que necesitaba andamiaje nuevo (`tests/soporte/equipo.js`):
 * el fixture `comercio` crea un propietario por test, y con un solo usuario no
 * hay forma de probar lo que la HU promete, que es que un empleado ve menos.
 *
 * Lo que agrega sobre `Backend/tests/miembros.test.js`, que ya cubre la matriz
 * de permisos endpoint por endpoint: aca se verifica que la *pantalla* respeta
 * el rol. Son dos capas distintas y las dos importan — el backend es el que
 * decide, pero un boton que se ofrece y termina en 403 es un bug de UX igual.
 */
test.describe("HU-4 — Roles y permisos", () => {
  test("el propietario ve los controles de administración", async ({
    page,
  }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("usuarios");

    await expect(configuracion.usuarios.correoInvitado).toBeVisible();
    await expect(configuracion.usuarios.invitar).toBeVisible();
    await expect(configuracion.usuarios.avisoSoloPropietario).toHaveCount(0);
  });

  test("invitar genera un link usable y la persona queda en el equipo", async ({
    page,
    api,
    playwright,
  }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("usuarios");

    // El alta del invitado va por API (ver equipo.js): armar el escenario no es
    // el sujeto del test. Lo que se verifica acá es que el equipo lo refleje.
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });

    await configuracion.ir("usuarios");

    const fila = page.getByRole("listitem").filter({ hasText: empleado.email });
    await expect(fila).toBeVisible();
    await expect(fila.getByLabel(/^Rol de /)).toHaveValue("empleado");
  });

  test("el empleado entra por el login y ve la pantalla en modo lectura", async ({
    api,
    playwright,
    browser,
  }) => {
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });

    // Contexto aparte: las cookies son del contexto, y reutilizar el del
    // propietario pisaría su sesión.
    const { context, page: paginaEmpleado } = await abrirComo(browser, undefined);

    try {
      // Entra por el formulario de verdad, no con la sesión puesta a mano: lo
      // que se prueba es el recorrido completo de una persona invitada.
      const login = new Login(paginaEmpleado);
      await login.ir();
      await login.entrar({
        correo: empleado.email,
        password: empleado.password,
      });
      await expect(login.saludo).toBeVisible();

      const suConfiguracion = new Configuracion(paginaEmpleado);
      await suConfiguracion.ir("ubicaciones");

      // Ve la lista —la necesita para registrar movimientos (HU-13)— pero no
      // puede tocarla.
      await expect(suConfiguracion.ubicaciones.soloLectura).toBeVisible();
      await expect(suConfiguracion.ubicaciones.nueva).toBeHidden();
      // El `hidden` saca el elemento del árbol de accesibilidad, así que el
      // botón no existe para `getByRole` en vez de estar solo invisible.
      await expect(suConfiguracion.ubicaciones.agregar).toHaveCount(0);
      // La moneda es solo del propietario.
      await expect(suConfiguracion.ubicaciones.moneda).toBeDisabled();
    } finally {
      await context.close();
    }
  });

  test("el empleado no puede administrar el equipo", async ({
    api,
    playwright,
    browser,
  }) => {
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const { context, page: paginaEmpleado } = await abrirComo(
      browser,
      empleado.storageState,
    );

    try {
      const suConfiguracion = new Configuracion(paginaEmpleado);
      await suConfiguracion.ir("usuarios");

      // El backend le responde 403 al pedir el equipo, así que la pantalla
      // muestra ese mensaje en vez de una lista que no puede ver.
      await expect(suConfiguracion.usuarios.error).toBeVisible();
      await expect(suConfiguracion.usuarios.correoInvitado).toHaveCount(0);
      await expect(suConfiguracion.usuarios.invitar).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("el gerente administra ubicaciones pero no la moneda", async ({
    api,
    playwright,
    browser,
  }) => {
    // El punto medio de la matriz de RF9, y el que más fácil se rompe: es el
    // único rol donde una parte de la pantalla se habilita y otra no.
    const gerente = await sumarMiembro(playwright, api, { rol: "gerente" });
    const { context, page: paginaGerente } = await abrirComo(
      browser,
      gerente.storageState,
    );

    try {
      const suConfiguracion = new Configuracion(paginaGerente);
      await suConfiguracion.ir("ubicaciones");

      await expect(suConfiguracion.ubicaciones.nueva).toBeVisible();
      await suConfiguracion.agregarUbicacion("Depósito del gerente");
      await expect(
        suConfiguracion.filaUbicacion("Depósito del gerente"),
      ).toBeVisible();

      await expect(suConfiguracion.ubicaciones.moneda).toBeDisabled();
    } finally {
      await context.close();
    }
  });

  test("cambiar el rol de alguien se aplica en el acto", async ({
    page,
    api,
    playwright,
    browser,
  }) => {
    // El criterio "el cambio de rol se refleja inmediatamente" de la HU.
    const persona = await sumarMiembro(playwright, api, { rol: "empleado" });

    const configuracion = new Configuracion(page);
    await configuracion.ir("usuarios");

    const fila = page.getByRole("listitem").filter({ hasText: persona.email });
    await fila.getByLabel(/^Rol de /).selectOption("gerente");
    await expect(fila.getByLabel(/^Rol de /)).toHaveValue("gerente");

    // Y del lado de la persona, sin que vuelva a iniciar sesión: la sesión es
    // la misma, lo que cambió es su fila en `member`.
    const { context, page: suPagina } = await abrirComo(
      browser,
      persona.storageState,
    );

    try {
      const suConfiguracion = new Configuracion(suPagina);
      await suConfiguracion.ir("ubicaciones");

      // Como gerente ya puede administrar ubicaciones, cosa que como empleado
      // no podía.
      await expect(suConfiguracion.ubicaciones.nueva).toBeVisible();
      await expect(suConfiguracion.ubicaciones.soloLectura).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
