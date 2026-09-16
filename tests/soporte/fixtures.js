import { test as base, expect } from "@playwright/test";
import { BASE_URL, PASSWORD, correoDePrueba, leerCorrida } from "./entorno.js";

/**
 * Fixtures de los E2E: un comercio propio por test, ya autenticado.
 *
 * El aislamiento no se logra limpiando datos, sino no compartiendolos: cada
 * test registra su propio comercio, asi que arranca con el catalogo vacio y no
 * puede ver ni pisar lo que creo otro. El `global-teardown` borra todo lo de la
 * corrida al final.
 *
 * El scope es de test y no de worker a proposito. Un comercio por worker seria
 * mas barato, pero los tests de un mismo worker corren en serie sobre el mismo
 * catalogo: el segundo ya arrancaria con los productos del primero y las
 * aserciones sobre el listado dependerian del orden. Un sign-up de mas por test
 * es un precio bajo por tests que se pueden correr sueltos y en cualquier orden.
 *
 * El alta se hace por API y no por la UI de registro: Better Auth tiene
 * `autoSignIn`, asi que el sign-up ya deja la sesion iniciada, y el hook
 * `user.create.after` del backend crea organization + member (rol
 * `propietario`) + comercio solo. Pasar por el formulario de registro ataria
 * todas las suites a una pantalla que ninguna de ellas viene a probar.
 */

let contadorComercios = 0;

export const test = base.extend({
  comercio: async ({ playwright }, use) => {
    const { sufijo } = leerCorrida();

    contadorComercios += 1;
    // El contador solo no alcanza: los workers son procesos distintos y cada
    // uno arranca el suyo en cero, asi que se le suma algo aleatorio.
    const etiqueta = `${contadorComercios}-${Math.random().toString(16).slice(2, 8)}`;
    const email = correoDePrueba(etiqueta, sufijo);

    const contexto = await playwright.request.newContext({ baseURL: BASE_URL });

    const respuesta = await contexto.post("/api/auth/sign-up/email", {
      data: { name: `Comercio E2E ${etiqueta}`, email, password: PASSWORD },
    });

    expect(
      respuesta.status(),
      `No se pudo registrar el comercio de prueba: ${await respuesta.text()}`,
    ).toBe(200);

    // La cookie de sesion (`better-auth.session_token`) queda en el storage
    // state del contexto de request; de ahi la toman el browser y el fixture
    // `api`.
    const storageState = await contexto.storageState();
    await contexto.dispose();

    await use({ email, etiqueta, storageState });
  },

  /**
   * Hace que `context` y `page` arranquen con la sesion del comercio del test:
   * se entra directo a la pantalla que el test quiere probar, sin pasar por el
   * login.
   */
  storageState: async ({ comercio }, use) => {
    await use(comercio.storageState);
  },

  /**
   * Cliente HTTP con la misma sesion, para armar escenarios y para verificar
   * lo que la UI no muestra (el stock vive en el detalle, no en el listado).
   */
  api: async ({ playwright, comercio }, use) => {
    const contexto = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: comercio.storageState,
    });

    await use(contexto);
    await contexto.dispose();
  },
});

export { expect };
