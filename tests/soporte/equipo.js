import { expect } from "@playwright/test";
import { BASE_URL, PASSWORD, correoDePrueba, leerCorrida } from "./entorno.js";

/**
 * Andamiaje para tener una SEGUNDA persona dentro del mismo comercio (HU-4).
 *
 * Es lo unico que le faltaba al repo para poder probar los roles de punta a
 * punta. El fixture `comercio` crea un propietario por test, y con un solo
 * usuario no hay forma de verificar lo que HU-4 promete: que un empleado ve
 * menos que el dueno. Dos comercios distintos tampoco sirven — ahi lo que se
 * prueba es el aislamiento entre tenants, que es otra cosa.
 *
 * Va por API y no por la UI a proposito, igual que el fixture `comercio`: armar
 * el escenario no es el sujeto de la prueba. Lo que si pasa por la UI es lo que
 * cada rol ve despues, que es lo que la HU promete.
 *
 * El correo se genera con el mismo `correoDePrueba` que el resto, asi que el
 * `global-teardown` lo borra con la corrida sin que haya que limpiar nada.
 */

let contadorMiembros = 0;

/** Crea una invitacion desde la sesion del propietario. */
export async function invitarViaApi(api, { correo, rol }) {
  const respuesta = await api.post("/api/miembros/invitaciones", {
    data: { correo, rol },
  });

  expect(
    respuesta.status(),
    `No se pudo invitar a ${correo} como ${rol}: ${await respuesta.text()}`,
  ).toBe(201);

  return respuesta.json();
}

/**
 * Suma una persona al comercio del test y devuelve su sesion.
 *
 * El alta lleva el `invitacionId`: con el, el hook `user.create.after` del
 * backend la suma al comercio que la invito en vez de crearle uno propio. Sin
 * ese campo terminaria siendo propietaria de un comercio nuevo y vacio, que es
 * justo lo contrario de lo que hace falta.
 *
 * @returns {Promise<{email: string, password: string, storageState: object}>}
 *   `storageState` sirve para abrir un `context` con esa sesion; `email` y
 *   `password`, para entrar por el formulario de login cuando el test quiere
 *   recorrer tambien esa parte.
 */
export async function sumarMiembro(playwright, api, { rol }) {
  const { sufijo } = leerCorrida();

  contadorMiembros += 1;
  const etiqueta = `${rol}-${contadorMiembros}-${Math.random().toString(16).slice(2, 8)}`;
  const email = correoDePrueba(etiqueta, sufijo);

  const invitacion = await invitarViaApi(api, { correo: email, rol });

  // `storageState` vacio a proposito, y no omitido: `request.newContext()`
  // HEREDA el `storageState` del test, asi que sin esto el contexto "nuevo"
  // sale con la cookie de sesion del propietario. Son dos problemas: primero,
  // esta mal de por si dar de alta a otra persona arrastrando la sesion de
  // alguien; y segundo, Better Auth ve una cookie, activa su chequeo de origen
  // —solo valida cuando el pedido lleva cookies— y como Playwright no manda
  // cabecera `Origin`, responde 403 MISSING_OR_NULL_ORIGIN.
  //
  // El fixture `comercio` no se topa con esto porque corre mientras se calcula
  // `comercio`, o sea antes de que exista ese `storageState`.
  const contexto = await playwright.request.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  });

  const alta = await contexto.post("/api/auth/sign-up/email", {
    data: {
      name: `E2E ${etiqueta}`,
      email,
      password: PASSWORD,
      invitacionId: invitacion.id,
    },
  });

  expect(
    alta.status(),
    `No se pudo dar de alta al ${rol} invitado: ${await alta.text()}`,
  ).toBe(200);

  const storageState = await contexto.storageState();
  await contexto.dispose();

  return { email, password: PASSWORD, storageState };
}

/**
 * Abre una pagina con la sesion de otra persona, en un contexto aparte.
 *
 * Hace falta un contexto propio y no `page.context()`: las cookies son del
 * contexto, asi que reutilizarlo pisaria la sesion del propietario y el test ya
 * no podria volver a mirar con sus ojos.
 *
 * Devuelve tambien el `context` para poder cerrarlo: Playwright cierra solo los
 * que abre el fixture, no los que abre el test.
 */
export async function abrirComo(browser, storageState) {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  return { context, page };
}
