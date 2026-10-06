import { expect, test } from "../soporte/fixtures.js";
import { BASE_URL } from "../soporte/entorno.js";

/**
 * Contrato HTTP de `POST /api/asistente/consultas` (HU-26), contra el stack
 * real y sin navegador.
 *
 * El último test es además un **detector de gasto**: el stack de Docker tiene
 * que correr sin key del AI Gateway (ver `docker-compose.yml`), y si alguna
 * vez llega una, ese test falla y lo dice. Sin él, los E2E podrían estar
 * gastando el crédito compartido del equipo en cada corrida sin que nadie se
 * entere hasta que el asistente deja de andar para todos.
 */
const RUTA = "/api/asistente/consultas";

test.describe("POST /api/asistente/consultas", () => {
  test("sin sesión responde 401", async ({ playwright }) => {
    const anonimo = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });

    try {
      const respuesta = await anonimo.post(RUTA, {
        data: { pregunta: "¿Qué tengo que reponer?" },
      });

      expect(respuesta.status()).toBe(401);
    } finally {
      await anonimo.dispose();
    }
  });

  test("una pregunta vacía responde 400", async ({ api }) => {
    const respuesta = await api.post(RUTA, { data: { pregunta: "   " } });

    expect(respuesta.status()).toBe(400);
    expect((await respuesta.json()).error).toBeTruthy();
  });

  test("una pregunta de más de 500 caracteres responde 400", async ({ api }) => {
    const respuesta = await api.post(RUTA, {
      data: { pregunta: "a".repeat(501) },
    });

    expect(respuesta.status()).toBe(400);
  });

  test("sin modelo disponible responde 200 en modo limitado, y nunca con el modelo", async ({
    api,
  }) => {
    const respuesta = await api.post(RUTA, {
      data: { pregunta: "¿Qué productos tengo que reponer?" },
    });

    expect(respuesta.status()).toBe(200);

    const cuerpo = await respuesta.json();

    expect(
      cuerpo.modo,
      "El asistente respondió con el modelo de lenguaje: el stack de Docker tiene " +
        "una key del AI Gateway y los E2E están gastando el crédito compartido del " +
        "equipo. Revisá que docker-compose.yml deje LLM_API_KEY y AI_GATEWAY_API_KEY vacías.",
    ).toBe("limitado");
    expect(cuerpo.respuesta).toEqual(expect.any(String));
    expect(cuerpo.respuesta.trim()).not.toBe("");
    expect(cuerpo.herramientasUsadas).toEqual([]);
  });
});
