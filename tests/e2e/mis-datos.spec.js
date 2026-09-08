import { readFile } from "node:fs/promises";
import { expect, test } from "../soporte/fixtures.js";
import { Configuracion } from "./soporte/configuracion.js";
import { Login } from "./soporte/login.js";
import { abrirComo, sumarMiembro } from "../soporte/equipo.js";

/**
 * E2E de HU-31 — derechos sobre los datos personales (Ley 25.326).
 *
 * La parte de credenciales de la HU (bcrypt, cabeceras, cookie HttpOnly, TLS a
 * la base) ya la cubre `Backend/tests/datosPersonales.test.js`, que tiene acceso
 * a la base y puede mirar el hash. Y `enrutamiento.spec.js` ya verifica el 401
 * sin sesion. Lo que faltaba y va aca son los dos derechos, por la pantalla:
 * llevarse los datos y darse de baja.
 *
 * La descarga es el caso que solo se puede probar en un navegador de verdad: el
 * archivo se arma con un Blob y un `<a download>` porque una navegacion directa
 * a `/api/mis-datos` no lleva la cookie en produccion. Un test de componente con
 * jsdom no distingue si eso funciona.
 */
test.describe("HU-31 — Mis datos", () => {
  test("la descarga entrega un archivo con los datos de la persona", async ({
    page,
    comercio,
  }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("mis-datos");

    const [descarga] = await Promise.all([
      page.waitForEvent("download"),
      configuracion.misDatos.descargar.click(),
    ]);

    expect(descarga.suggestedFilename()).toBe("mis-datos.json");

    const contenido = JSON.parse(await readFile(await descarga.path(), "utf8"));

    expect(contenido.cuenta.correo).toBe(comercio.email);
    expect(contenido.comercios).toHaveLength(1);
    expect(contenido.sesionesActivas.length).toBeGreaterThan(0);
  });

  test("el archivo nunca lleva la contraseña", async ({ page }) => {
    // El punto central de la HU: el hash es justamente lo que no debe salir del
    // sistema, ni siquiera en la exportación que la ley obliga a entregar.
    const configuracion = new Configuracion(page);
    await configuracion.ir("mis-datos");

    const [descarga] = await Promise.all([
      page.waitForEvent("download"),
      configuracion.misDatos.descargar.click(),
    ]);

    const crudo = await readFile(await descarga.path(), "utf8");

    expect(crudo).not.toMatch(/\$2[aby]\$/);
    expect(crudo.toLowerCase()).not.toContain("unaclavesegura123");
  });

  test("la baja no se dispara con un solo clic", async ({ page }) => {
    const configuracion = new Configuracion(page);
    await configuracion.ir("mis-datos");

    await configuracion.misDatos.quieroBaja.click();

    // Aparece la confirmación, y el botón queda bloqueado hasta escribir la
    // palabra. Es la única acción irreversible de la app.
    await expect(configuracion.misDatos.confirmacion).toBeVisible();
    await expect(configuracion.misDatos.confirmarBaja).toBeDisabled();

    await configuracion.misDatos.confirmacion.fill("cualquier cosa");
    await expect(configuracion.misDatos.confirmarBaja).toBeDisabled();

    await configuracion.misDatos.confirmacion.fill("BAJA");
    await expect(configuracion.misDatos.confirmarBaja).toBeEnabled();
  });

  test("al único propietario no se lo deja ir", async ({ page }) => {
    // El comercio quedaría sin nadie que pueda administrarlo.
    const configuracion = new Configuracion(page);
    await configuracion.ir("mis-datos");

    await configuracion.misDatos.quieroBaja.click();
    await configuracion.misDatos.confirmacion.fill("BAJA");
    await configuracion.misDatos.confirmarBaja.click();

    await expect(configuracion.misDatos.error).toBeVisible();
    await expect(configuracion.misDatos.error).toContainText(
      /único propietario/i,
    );
    // Sigue adentro.
    await expect(page).toHaveURL(/\/configuracion/);
  });

  test("un empleado sí puede darse de baja, y después no entra más", async ({
    api,
    playwright,
    browser,
  }) => {
    // El recorrido completo del derecho de supresión: quien no es propietario
    // de nada se puede ir, y la cuenta queda inutilizable de verdad.
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const { context, page: paginaEmpleado } = await abrirComo(
      browser,
      empleado.storageState,
    );

    try {
      const suConfiguracion = new Configuracion(paginaEmpleado);
      await suConfiguracion.ir("mis-datos");

      await suConfiguracion.misDatos.quieroBaja.click();
      await suConfiguracion.misDatos.confirmacion.fill("BAJA");
      await suConfiguracion.misDatos.confirmarBaja.click();

      // La baja borra las sesiones del lado del servidor, así que la pantalla
      // manda al login.
      await expect(paginaEmpleado).toHaveURL(/\/login/);

      // Y con la contraseña de antes ya no se entra: el hash se borró.
      const login = new Login(paginaEmpleado);
      await login.entrar({
        correo: empleado.email,
        password: empleado.password,
      });

      await expect(login.error).toBeVisible();
      await expect(login.saludo).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("el correo de quien se fue desaparece de la auditoría", async ({
    page,
    api,
    playwright,
    browser,
  }) => {
    // Es la parte que hace que la anonimización sea real: los hechos quedan
    // —son del comercio— pero ya no identifican a nadie.
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const { context, page: paginaEmpleado } = await abrirComo(
      browser,
      empleado.storageState,
    );

    try {
      const suConfiguracion = new Configuracion(paginaEmpleado);
      await suConfiguracion.ir("mis-datos");
      await suConfiguracion.misDatos.quieroBaja.click();
      await suConfiguracion.misDatos.confirmacion.fill("BAJA");
      await suConfiguracion.misDatos.confirmarBaja.click();
      await expect(paginaEmpleado).toHaveURL(/\/login/);
    } finally {
      await context.close();
    }

    // Desde la sesión del propietario, que sí puede leer la auditoría.
    const configuracion = new Configuracion(page);
    await configuracion.ir("auditoria");

    await expect(configuracion.auditoria.titulo).toBeVisible();
    await expect(page.getByText(empleado.email)).toHaveCount(0);
  });
});
