import { defineConfig, devices } from "@playwright/test";

/**
 * Tests del stack completo.
 *
 * Corren contra `http://localhost`, que es Nginx: los contenedores `frontend` y
 * `backend` usan `expose` y no `ports`, asi que no son alcanzables desde el
 * host. Es a proposito — se entra por la misma puerta que un usuario.
 *
 * No hay `webServer`: el stack se levanta a mano con `docker compose up
 * --build` (ver README). Meter un `--build` de varios minutos adentro del
 * runner esconde los logs de Docker entre los del test y hace ilegible el
 * primer arranque. `global-setup.js` verifica que el stack este arriba y que
 * Backend/Frontend esten en `dev` antes de correr nada.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.js",
  globalTeardown: "./tests/global-teardown.js",

  // Cada test trabaja sobre su propio comercio, asi que el paralelismo no
  // genera interferencia entre tests (ver tests/e2e/soporte/fixtures.js).
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Un reintento, no para tapar tests inestables sino por una falla concreta y
  // ajena: cada tanto una consulta contra Neon corta por ETIMEDOUT. Sale de dos
  // formas, y conviene reconocer las dos porque parecen problemas distintos:
  // si la que corta es la de sesion, Better Auth responde 500 y la ruta
  // protegida lo lee como "no hay sesion" y manda al login; si corta cualquier
  // otra, Nginx devuelve un 502 en la llamada a la API. En los dos casos el
  // test cae por algo que no tiene que ver con lo que prueba, y el backend
  // sigue arriba (se confirma con `docker inspect` — RestartCount no sube).
  // Playwright igual lo marca como "flaky" en el reporte, asi que el ruido
  // queda a la vista en vez de desaparecer.
  retries: 1,

  // El limite no es la CPU sino Neon: la base es remota y compartida, y por
  // arriba de dos workers las consultas de sesion empiezan a cortar por
  // ETIMEDOUT y el backend responde 500 (la pantalla protegida lo lee como
  // "no hay sesion" y manda al login, que es un falso negativo dificil de
  // diagnosticar). El default de Playwright es la mitad de los nucleos, que en
  // una maquina grande dispara justo eso. Se puede subir con `--workers=N` si
  // se corre contra una base local.
  workers: 2,

  reporter: [["list"], ["html", { open: "never" }]],

  // La red hasta Neon y el refetch completo del listado tras cada operacion
  // hacen que los defaults de Playwright queden cortos en la primera corrida.
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    locale: "es-AR",
    // Fijada, y no heredada del reloj de la maquina, porque hay filtros por dia
    // que SE RESUELVEN EN EL NAVEGADOR. Un `<input type="date">` entrega
    // "AAAA-MM-DD" y el Frontend lo convierte al primer/ultimo instante de ese
    // dia en hora local (`inicioDelDia`/`finDelDia` en
    // Frontend/src/services/movimientos.js) antes de mandarlo; el backend solo
    // compara contra el instante que recibe. O sea que la zona que decide que
    // cae adentro del filtro es la del browser, no la del contenedor ni la de
    // Node: una compra de las 22 h en Argentina ya es del dia siguiente en UTC,
    // y el historial de HU-21 la dejaria afuera por un dia.
    //
    // Hasta ahora la suite pasaba por casualidad, porque la maquina de
    // desarrollo ya esta en esta zona. Dicho aca, deja de depender de eso.
    //
    // OJO: esto fija la zona del NAVEGADOR. El proceso de Node que corre los
    // tests sigue en la del sistema, asi que un dia calculado con `new Date()`
    // en el spec puede no ser el que ve la pantalla. Cuando un test necesita
    // "que dia es esto para el navegador", lo pregunta con `page.evaluate`
    // (ver `diaDe` en tests/e2e/soporte/historialCompras.js).
    timezoneId: "America/Argentina/Buenos_Aires",
  },

  projects: [
    {
      // Lo que recorre un usuario por la interfaz.
      name: "chromium",
      testDir: "./tests/e2e",
      use: {
        ...devices["Desktop Chrome"],
        // Por defecto se usa el Chromium que baja `npx playwright install`,
        // que es el que garantiza que todos veamos lo mismo. `E2E_CHANNEL=chrome`
        // (o `msedge`) usa el navegador ya instalado en la maquina: sirve
        // cuando bajar esos 200 MB no es viable, con la salvedad de que se
        // testea contra una version de Chrome que no controlamos.
        ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
      },
    },
    {
      // Lo que no se ve por pantalla y hay que verificar contra la API y la
      // base: que la transaccion de HU-13 no deje el stock a medias, que el
      // contrato de la importacion de HU-7 rechace el archivo entero cuando
      // corresponde, el enrutamiento de Nginx, y que dos transferencias cruzadas
      // de HU-12 no se pisen. Sin `devices` y sin nada que use `page`, asi que no
      // levanta navegador — Playwright solo lo arranca cuando un test pide el
      // fixture.
      name: "api",
      testDir: "./tests/api",
    },
  ],
});
