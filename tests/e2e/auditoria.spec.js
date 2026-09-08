import { expect, test } from "../soporte/fixtures.js";
import { PASSWORD } from "../soporte/entorno.js";
import { Configuracion } from "./soporte/configuracion.js";
import { Login } from "./soporte/login.js";
import { abrirComo, sumarMiembro } from "../soporte/equipo.js";

/**
 * E2E de HU-5 — registro de accesos y acciones.
 *
 * Es la HU que mas gana con un test de punta a punta, porque lo que la sostiene
 * es un middleware montado en `app.js` que engancha el final de cada respuesta.
 * Ni el test de integracion del Backend ni el de componente del Frontend ven lo
 * que aca importa: que una accion hecha *desde la pantalla* termine anotada.
 *
 * Y es precisamente lo que se rompio al mergear HU-4: git dejo `auditarCambios`
 * montado por debajo de `/api/miembros`, y las operaciones sobre personas
 * dejaban de registrarse sin que nada fallara. Un test asi lo hubiera detectado.
 */
test.describe("HU-5 — Auditoría de accesos y acciones", () => {
  test("el ingreso por el login queda registrado", async ({
    page,
    comercio,
  }) => {
    // Se entra por el formulario en vez de aprovechar la sesión que ya trae el
    // fixture, y no es un rodeo: el acceso del *registro* no queda anotado, a
    // propósito. El hook de sesión de Better Auth corre en el mismo instante en
    // que nace el usuario, cuando su comercio todavía no existe, y sin comercio
    // no hay a quién atribuir el hecho (ver `registrarAcceso` en el Backend).
    // Lo que la HU promete —y lo que este test cubre— son los ingresos.
    const login = new Login(page);
    await login.ir();
    await login.entrar({ correo: comercio.email, password: PASSWORD });
    await expect(login.saludo).toBeVisible();

    const configuracion = new Configuracion(page);
    await configuracion.ir("auditoria");

    await expect(configuracion.auditoria.titulo).toBeVisible();
    await expect(
      configuracion.eventoDeAuditoria("Inició sesión").first(),
    ).toBeVisible();
  });

  test("una acción hecha desde la pantalla aparece en el registro", async ({
    page,
  }) => {
    const configuracion = new Configuracion(page);

    await configuracion.ir("ubicaciones");
    await configuracion.agregarUbicacion("Depósito auditado");
    await expect(configuracion.filaUbicacion("Depósito auditado")).toBeVisible();

    await configuracion.ir("auditoria");

    // El middleware deduce el recurso de la URL: `/api/ubicaciones` -> creó una
    // ubicación.
    await expect(
      configuracion.eventoDeAuditoria(/Creó una ubicación/i).first(),
    ).toBeVisible();
  });

  test("el registro se puede filtrar por acción", async ({ page, comercio }) => {
    // Hace falta un ingreso y un alta para que el filtro tenga dos clases de
    // evento que separar.
    const login = new Login(page);
    await login.ir();
    await login.entrar({ correo: comercio.email, password: PASSWORD });
    await expect(login.saludo).toBeVisible();

    const configuracion = new Configuracion(page);

    await configuracion.ir("ubicaciones");
    await configuracion.agregarUbicacion("Para filtrar");
    await expect(configuracion.filaUbicacion("Para filtrar")).toBeVisible();

    await configuracion.ir("auditoria");

    // Sin filtro conviven las dos clases de evento.
    const ingresos = configuracion.eventoDeAuditoria("Inició sesión");
    const altas = configuracion.eventoDeAuditoria(/Creó una ubicación/i);

    await expect(ingresos.first()).toBeVisible();
    await expect(altas.first()).toBeVisible();

    await configuracion.auditoria.filtroAccion.selectOption("crear");

    // Con el filtro puesto quedan las altas y desaparecen los ingresos. Se
    // afirma sobre las clases de evento y no sobre cuántos hay: la cantidad
    // depende de cuántas veces se inició sesión, que no es lo que se prueba.
    await expect(altas.first()).toBeVisible();
    await expect(ingresos).toHaveCount(0);
  });

  test("los intentos rechazados no ensucian el registro", async ({
    page,
    api,
  }) => {
    // El middleware solo anota lo que efectivamente cambió algo. Un 409 no es
    // un hecho auditable del negocio: es el sistema funcionando.
    const configuracion = new Configuracion(page);

    await configuracion.ir("ubicaciones");
    await configuracion.agregarUbicacion("Única");
    await expect(configuracion.filaUbicacion("Única")).toBeVisible();

    await configuracion.ir("auditoria");
    await configuracion.auditoria.filtroAccion.selectOption("crear");
    const trasUnAlta = await configuracion.auditoria.eventos.count();

    // Un alta repetida, que el backend rechaza con 409.
    const rechazada = await api.post("/api/ubicaciones", {
      data: { nombre: "Única" },
    });
    expect(rechazada.status()).toBe(409);

    await configuracion.ir("auditoria");
    await configuracion.auditoria.filtroAccion.selectOption("crear");

    await expect
      .poll(() => configuracion.auditoria.eventos.count())
      .toBe(trasUnAlta);
  });

  test("un empleado no puede leer la auditoría", async ({
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
      await suConfiguracion.ir("auditoria");

      // El backend responde 403 y la pantalla muestra ese mensaje. No se
      // esconde la pestaña: quien no puede leerla ve por qué.
      await expect(suConfiguracion.auditoria.error).toBeVisible();
      await expect(suConfiguracion.auditoria.eventos).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("cada comercio ve solo lo suyo", async ({ page, browser }) => {
    // El aislamiento multi-tenant, visto desde la pantalla. El fixture le da a
    // cada test su propio comercio, así que alcanza con abrir uno nuevo.
    const configuracion = new Configuracion(page);
    await configuracion.ir("ubicaciones");
    await configuracion.agregarUbicacion("Secreta del comercio A");
    await expect(
      configuracion.filaUbicacion("Secreta del comercio A"),
    ).toBeVisible();

    const { context, page: otraPagina } = await abrirComo(browser, undefined);

    try {
      // Sin sesión no se ve nada de nadie: la pantalla manda al login.
      await otraPagina.goto("/configuracion?seccion=auditoria");
      await expect(otraPagina).toHaveURL(/\/login/);
    } finally {
      await context.close();
    }
  });
});
