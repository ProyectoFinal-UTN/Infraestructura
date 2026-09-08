import { expect, test } from "@playwright/test";
import { PASSWORD, correoDePrueba, leerCorrida } from "../soporte/entorno.js";
import { Registro } from "./soporte/registro.js";
import { Catalogo } from "./soporte/catalogo.js";

/**
 * E2E de HU-1 — registro real por la interfaz, hasta entrar a Productos.
 *
 * Es el único spec de toda la suite que pasa por el formulario de `/registro`:
 * los demás registran su comercio por API a propósito, para no atar suites que
 * no vienen a probar esa pantalla (ver el comentario del fixture `comercio` en
 * tests/soporte/fixtures.js). Este test sí viene a probar esa pantalla, y de
 * paso recorre el camino más largo que puede hacer un usuario nuevo a través
 * del stack: Frontend (formulario) -> Nginx -> Backend (Better Auth + el hook
 * que crea organization/member/comercio) -> Frontend otra vez, ya con sesión
 * -> Backend (GET /api/productos) para el catálogo.
 *
 * Es justo lo que un test unitario de cada repo por separado no puede probar:
 * que Better Auth, el hook de alta de comercio y la SPA servida por Nginx
 * encajan como un solo sistema para un usuario que nunca tuvo sesión.
 *
 * No usa el fixture `comercio` de tests/soporte/fixtures.js a propósito: ese
 * registra por API. Genera su propio email con el mismo generador que usan las
 * demás suites, así global-teardown.js lo limpia igual sin tocar nada.
 */
test.describe("HU-1 — Registro de cuenta", () => {
  test("una cuenta nueva queda con sesión iniciada y puede entrar a Productos", async ({
    page,
  }) => {
    const { sufijo } = leerCorrida();
    const etiqueta = `registro-${Math.random().toString(16).slice(2, 8)}`;
    const email = correoDePrueba(etiqueta, sufijo);

    const registro = new Registro(page);
    await registro.ir();
    await registro.completar({
      correo: email,
      password: PASSWORD,
      confirmacion: PASSWORD,
    });
    await registro.enviar();

    // El registro deja la sesión iniciada y entra directo al inicio: sin esto
    // no habría forma de distinguir una cuenta creada de un error silencioso.
    await expect(registro.saludo).toBeVisible();
    await expect(registro.errorGeneral).toHaveCount(0);

    // Entra por el link real, no por `page.goto("/productos")`: lo que este
    // test agrega sobre el resto de la suite es que la navegación autenticada
    // funciona de punta a punta, no solo que la pantalla renderiza con una
    // sesión ya puesta a mano.
    await registro.enlaceProductos.click();

    const catalogo = new Catalogo(page);
    await expect(catalogo.titulo).toBeVisible();
    await expect(catalogo.listaVacia).toBeVisible();
  });
});
