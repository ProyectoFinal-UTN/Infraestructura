import { expect, test } from "../soporte/fixtures.js";
import { crearProductoViaApi } from "../soporte/datos.js";
import { Asistente } from "./soporte/asistente.js";

/**
 * E2E de HU-28 — Modo degradado del asistente.
 *
 * El stack de Docker corre sin key del AI Gateway (ver `docker-compose.yml`),
 * así que el asistente SIEMPRE responde por reglas. Es justo lo que se quiere
 * probar acá, y por eso estos tests pueden afirmar sobre datos concretos: las
 * reglas son determinísticas, y la misma pregunta con los mismos datos da
 * siempre la misma respuesta. No gastan crédito ni dependen de un tercero.
 *
 * Lo que agrega sobre `Backend/tests/asistente.reglas.test.js`, que ya cubre
 * qué intención se reconoce en cada pregunta: acá las consultas corren contra
 * la base de verdad, con los productos que el test acaba de cargar, y la
 * respuesta se lee en la pantalla.
 */
test.describe("HU-28 — Modo degradado del asistente", () => {
  test("sin modelo, responde qué hay que reponer con los datos del comercio", async ({
    page,
    api,
  }) => {
    const bajo = await crearProductoViaApi(api, {
      umbralMinimo: "5",
      stockActual: "1",
    });

    await page.goto("/");
    const asistente = new Asistente(page);
    await asistente.abrir();

    const turno = await asistente.preguntar("¿Qué productos tengo que reponer?");

    await expect(turno).toContainText(bajo.nombre);
    await expect(turno).toContainText("queda 1 unidad, el mínimo es 5");
    // El criterio de aceptación: la persona sabe que es una respuesta limitada.
    await expect(turno.getByText(/respuesta limitada/i)).toBeVisible();
  });

  test("un producto con stock de sobra no aparece para reponer", async ({
    page,
    api,
  }) => {
    await crearProductoViaApi(api, { umbralMinimo: "5", stockActual: "20" });

    await page.goto("/");
    const asistente = new Asistente(page);
    await asistente.abrir();

    const turno = await asistente.preguntar("¿Qué productos tengo que reponer?");

    await expect(turno).toContainText(
      "No tenés productos por debajo del stock mínimo.",
    );
  });

  test("responde cuánto queda de un producto", async ({ page, api }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "20" });

    await page.goto("/");
    const asistente = new Asistente(page);
    await asistente.abrir();

    // "coca" y no el nombre entero: así lo escribiría alguien, y prueba la
    // búsqueda parcial contra la base real.
    const turno = await asistente.preguntar("¿Cuánta coca me queda?");

    await expect(turno).toContainText(
      `De ${producto.nombre} te quedan 20 unidades.`,
    );
  });

  test("lo que no entiende, lo dice y explica qué se puede preguntar", async ({
    page,
  }) => {
    await page.goto("/");
    const asistente = new Asistente(page);
    await asistente.abrir();

    const turno = await asistente.preguntar("hola, ¿cómo andás?");

    await expect(turno).toContainText("solo puedo responder algunas preguntas");
    // No es un error: no hay ningún aviso de falla.
    await expect(turno.getByRole("alert")).toHaveCount(0);
  });
});
