import { expect, test } from "../soporte/fixtures.js";
import { abrirComo, sumarMiembro } from "../soporte/equipo.js";
import { Asistente } from "./soporte/asistente.js";

/**
 * E2E de HU-26 — Consulta en lenguaje natural.
 *
 * **Estos tests no llaman al modelo de lenguaje.** El `docker-compose.yml`
 * vacía la key del AI Gateway para el stack, así que el asistente responde en
 * modo limitado (HU-28): es deterministico, no gasta el crédito compartido del
 * equipo (US$ 5 por mes para los tres) y no depende de que el proveedor esté
 * arriba. Lo que se prueba acá es la integración —el botón en todas las
 * pantallas, el circuito pregunta → backend → respuesta, los roles— y no la
 * calidad de lo que redacta el modelo, que se cubre con los unitarios del
 * Backend contra un mock.
 *
 * Tampoco se afirma sobre el texto exacto de la respuesta limitada: lo escribe
 * HU-28 y va a cambiar. Se afirma sobre el contrato, que es que la pantalla
 * avise que la respuesta es limitada.
 */
test.describe("HU-26 — Consulta en lenguaje natural", () => {
  test("el asistente está en todas las pantallas con sesión", async ({
    page,
  }) => {
    // Es el primer criterio de aceptación: "accesible desde cualquier
    // pantalla del sistema".
    const asistente = new Asistente(page);

    for (const ruta of ["/", "/productos", "/movimientos", "/configuracion"]) {
      await page.goto(ruta);
      await expect(asistente.boton, `falta el asistente en ${ruta}`).toBeVisible();
    }
  });

  test("responde la pregunta y avisa que la respuesta es limitada", async ({
    page,
  }) => {
    await page.goto("/");
    const asistente = new Asistente(page);
    await asistente.abrir();

    const turno = await asistente.preguntar("¿Qué productos tengo que reponer?");

    // Sin key en el stack, el backend responde por reglas. Es una respuesta
    // y no un error: no hay ningún aviso de falla, y sí el de modo limitado.
    await expect(turno.getByText(/respuesta limitada/i)).toBeVisible();
    await expect(turno.getByRole("alert")).toHaveCount(0);
  });

  test("la conversación sobrevive al navegar dentro de la app", async ({
    page,
  }) => {
    await page.goto("/");
    const asistente = new Asistente(page);
    await asistente.abrir();
    await asistente.preguntar("¿Cómo viene el día?");

    // Con un link de la app y no con `goto`: `goto` recarga la página, y lo que
    // se quiere probar es justamente que la navegación interna no desmonta el
    // asistente.
    await page.getByRole("link", { name: "Historial de movimientos" }).click();
    await expect(page).toHaveURL(/\/movimientos$/);

    await expect(
      asistente.turnos.filter({ hasText: "¿Cómo viene el día?" }),
    ).toBeVisible();
  });

  test("un empleado también lo puede usar", async ({
    api,
    playwright,
    browser,
  }) => {
    // El permiso `asistente:consultar` lo tienen los tres roles. Se prueba con
    // el empleado porque es el que menos permisos tiene: si a él le anda, el
    // permiso está bien repartido.
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const { context, page } = await abrirComo(browser, empleado.storageState);

    try {
      await page.goto("/");
      const asistente = new Asistente(page);
      await asistente.abrir();

      const turno = await asistente.preguntar("¿Qué tengo que reponer?");

      await expect(turno.getByText(/respuesta limitada/i)).toBeVisible();
      await expect(turno.getByRole("alert")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("sin sesión no aparece", async ({ browser }) => {
    // Contexto sin cookies: el del test arranca con la sesión del comercio.
    const { context, page } = await abrirComo(browser, {
      cookies: [],
      origins: [],
    });

    try {
      await page.goto("/login");
      await expect(
        page.getByRole("heading", { name: "Iniciar sesión" }),
      ).toBeVisible();

      await expect(new Asistente(page).boton).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
