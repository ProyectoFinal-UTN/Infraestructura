import { expect, test } from "@playwright/test";

/**
 * Enrutamiento de Nginx contra el stack real (ver nginx/locations.conf).
 *
 * No usa las fixtures de `tests/soporte/`: ninguno de estos casos necesita un
 * comercio ni una sesión, y el que sí verifica una sesión lo hace justamente
 * verificando que NO la hay. Corre en el proyecto `api` (sin browser) porque
 * lo que se comprueba es la respuesta HTTP cruda, no lo que se ve en pantalla.
 *
 * Por que estos cuatro y no otros: cada uno prueba una `location` distinta de
 * locations.conf, y entre las cuatro cubren el único punto de entrada público
 * del stack. `GET /health` además funciona como smoke test reportado: si el
 * backend no está sano, este test lo dice en el reporte en vez de que la única
 * señal sea el timeout silencioso de `global-setup.js` (que hace el mismo
 * chequeo, pero como gate previo, no como resultado).
 */
test.describe("Enrutamiento de Nginx", () => {
  test("GET / sirve el HTML del Frontend", async ({ request }) => {
    const respuesta = await request.get("/");

    expect(respuesta.status()).toBe(200);
    expect(respuesta.headers()["content-type"]).toContain("text/html");

    const cuerpo = await respuesta.text();
    expect(cuerpo).toContain("<title>Gestión Comercial PyME</title>");
    expect(cuerpo).toContain('<div id="root">');
  });

  test("GET /health devuelve el estado del Backend", async ({ request }) => {
    const respuesta = await request.get("/health");

    expect(respuesta.status()).toBe(200);
    expect(await respuesta.json()).toEqual({ status: "ok" });
  });

  test("GET /api/... sin sesión devuelve 401 con las rutas intactas", async ({
    request,
  }) => {
    // Confirma que proxy_pass conserva el path completo. El bug que comenta
    // nginx.conf (la barra final en proxy_pass) mandaría esto a
    // http://backend/, que resolvería en un 404 de Express y no en el 401 de
    // la ruta protegida real.
    const respuesta = await request.get("/api/productos");

    expect(respuesta.status()).toBe(401);
    expect(await respuesta.json()).toEqual({ error: "No hay sesion activa" });
  });

  test("GET /api-docs/ sirve el Swagger UI", async ({ request }) => {
    const respuesta = await request.get("/api-docs/");

    expect(respuesta.status()).toBe(200);
    expect(respuesta.headers()["content-type"]).toContain("text/html");

    const cuerpo = await respuesta.text();
    expect(cuerpo.toLowerCase()).toContain("swagger-ui");
  });
});
