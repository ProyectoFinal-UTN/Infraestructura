import { defineConfig, devices } from "@playwright/test";

/**
 * Tests E2E del stack completo (HU-9 / SCRUM-91).
 *
 * Corren contra `http://localhost`, que es Nginx: los contenedores `frontend` y
 * `backend` usan `expose` y no `ports`, asi que no son alcanzables desde el
 * host. Es a proposito — el E2E entra por la misma puerta que un usuario.
 *
 * No hay `webServer`: el stack se levanta a mano con `docker compose up
 * --build` (ver README). Meter un `--build` de varios minutos adentro del
 * runner esconde los logs de Docker entre los del test y hace ilegible el
 * primer arranque. `global-setup.js` verifica que el stack este arriba y que
 * Backend/Frontend esten en `dev` antes de correr nada.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/global-setup.js",
  globalTeardown: "./tests/global-teardown.js",

  // Cada test trabaja sobre su propio comercio, asi que el paralelismo no
  // genera interferencia entre tests (ver tests/e2e/soporte/fixtures.js).
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Un reintento, no para tapar tests inestables sino por una falla concreta y
  // ajena: cada tanto la consulta de sesion contra Neon corta por ETIMEDOUT,
  // Better Auth responde 500 y la ruta protegida lo interpreta como "no hay
  // sesion" y manda al login. El test cae por algo que no tiene que ver con lo
  // que prueba. Playwright igual lo marca como "flaky" en el reporte, asi que
  // el ruido queda a la vista en vez de desaparecer.
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
  },

  projects: [
    {
      name: "chromium",
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
  ],
});
