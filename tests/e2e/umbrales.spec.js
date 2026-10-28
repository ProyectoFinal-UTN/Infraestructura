import { expect, test } from "../soporte/fixtures.js";
import {
  crearProductoViaApi,
  crearUbicacionViaApi,
  productoValido,
} from "../soporte/datos.js";
import {
  abrirComo,
  cambiarRolViaApi,
  leerMiembros,
  miembroPorCorreo,
  sumarMiembro,
} from "../soporte/equipo.js";
import { Catalogo } from "./soporte/catalogo.js";
import { BloqueUmbral, DetalleProducto } from "./soporte/detalleProducto.js";
import { contarPedidos } from "./soporte/red.js";

/**
 * E2E de HU-16 — configurar el umbral de reposicion de un producto desde su
 * detalle (`/productos/:id`).
 *
 * Corren contra el stack completo: el bundle de produccion del Frontend servido
 * por Nginx, hablando con el Backend real y con Neon.
 *
 * Toda asercion sobre el umbral se hace dos veces: contra lo que muestra el
 * bloque y contra `GET /api/productos/:id/umbral`. Es lo que separa «se dibujo
 * un numero» de «se guardo», el mismo criterio que `detalle-producto.spec.js`
 * aplica al stock.
 *
 * Que NO se prueba aca: los 400 uno por uno, el 401 y el aislamiento entre
 * comercios. La pantalla nunca manda un `"10"` ni un `null`, y un producto
 * ajeno no se puede abrir; eso esta en `tests/api/umbrales.spec.js`.
 *
 * Cada test trae su propio comercio (fixture `comercio`), asi que se puede
 * correr suelto, en cualquier orden y en paralelo.
 */

/** El umbral segun el backend, que es la contraprueba de la pantalla. */
async function umbralSegunApi(api, productoId) {
  const respuesta = await api.get(`/api/productos/${productoId}/umbral`);

  expect(
    respuesta.status(),
    `No se pudo leer el umbral de ${productoId}: ${await respuesta.text()}`,
  ).toBe(200);

  return (await respuesta.json()).umbralMinimo;
}

/**
 * Los PUT al umbral que dispara la pantalla. Se cuentan por lo mismo que los
 * POST de los ajustes de HU-11: sin esto, «muestra el error» pasaria igual si
 * el backend fuera el que rechaza y la pantalla solo mostrara ese rechazo.
 */
function contarGuardados(page, producto) {
  return contarPedidos(page, `/api/productos/${producto.id}/umbral`, "PUT");
}

test.describe("HU-16 — Umbral de reposición", () => {
  test("el propietario configura el umbral de un producto nuevo y queda guardado", async ({
    page,
    api,
  }) => {
    // 0 es el default de la columna y lo que significa "sin umbral".
    const producto = await crearProductoViaApi(api, { umbralMinimo: "0" });

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();

    await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.SIN_UMBRAL);
    await expect(detalle.umbral.campo).toHaveValue("0");

    await detalle.umbral.configurar("12");

    await expect(detalle.umbral.confirmacion).toHaveText(BloqueUmbral.CONFIRMACION);
    await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(12));
    await expect(detalle.umbral.errorDelCampo).toHaveCount(0);
    expect(await umbralSegunApi(api, producto.id)).toBe(12);

    // Recargar es lo que prueba que persistio: el estado de React se pierde y
    // lo que se ve sale de un GET nuevo. La confirmacion, en cambio, no tiene
    // por que sobrevivir.
    await page.reload();
    await expect(detalle.titulo).toBeVisible();

    await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(12));
    await expect(detalle.umbral.campo).toHaveValue("12");
    await expect(detalle.umbral.confirmacion).toHaveCount(0);
  });

  test("no guarda un umbral vacío, negativo o decimal, y no llega a llamar al backend", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });

    const detalle = new DetalleProducto(page, producto);
    const guardados = contarGuardados(page, producto);
    await detalle.ir();

    await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(5));

    const casos = [
      { valor: "", error: "Ingresá un número." },
      {
        valor: "-1",
        error: "Tiene que ser un número entero, sin decimales ni signos.",
      },
      {
        valor: "2.5",
        error: "Tiene que ser un número entero, sin decimales ni signos.",
      },
    ];

    for (const caso of casos) {
      await detalle.umbral.configurar(caso.valor);

      await expect(detalle.umbral.errorDelCampo, `valor «${caso.valor}»`).toHaveText(
        caso.error,
      );
      // El mensaje queda asociado al campo, que es lo que lo hace audible.
      await expect(detalle.umbral.campo).toHaveAttribute(
        "aria-describedby",
        "error-umbralMinimo",
      );
      await expect(detalle.umbral.confirmacion).toHaveCount(0);
      await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(5));
    }

    // Nada salio del navegador y el backend sigue con el valor de antes.
    expect(guardados, "un umbral inválido llegó al backend").toHaveLength(0);
    expect(await umbralSegunApi(api, producto.id)).toBe(5);

    // Corregir el campo alcanza para seguir: el formulario no quedo trabado, y
    // es lo que le da sentido al conteo de arriba — si los PUT nunca se
    // contaran, aquel `toHaveLength(0)` pasaria sin probar nada.
    await detalle.umbral.configurar("7");

    await expect(detalle.umbral.confirmacion).toHaveText(BloqueUmbral.CONFIRMACION);
    await expect(detalle.umbral.errorDelCampo).toHaveCount(0);
    await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(7));
    expect(guardados).toHaveLength(1);
    expect(await umbralSegunApi(api, producto.id)).toBe(7);
  });

  test("el umbral se puede modificar en cualquier momento, y volver a 0 lo quita", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "0" });

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();

    await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.SIN_UMBRAL);

    // Dos cambios seguidos sin salir de la pantalla: el segundo tiene que
    // partir del valor que dejo el primero, no del que habia al entrar.
    for (const valor of [8, 3]) {
      await detalle.umbral.configurar(String(valor));

      await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(valor));
      await expect(detalle.umbral.confirmacion).toHaveText(BloqueUmbral.CONFIRMACION);
      expect(await umbralSegunApi(api, producto.id)).toBe(valor);
    }

    await detalle.umbral.configurar("0");

    await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.SIN_UMBRAL);
    await expect(detalle.umbral.confirmacion).toHaveText(BloqueUmbral.CONFIRMACION);
    expect(await umbralSegunApi(api, producto.id)).toBe(0);
  });

  test("el gerente también puede cambiar el umbral", async ({
    api,
    playwright,
    browser,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });
    const gerente = await sumarMiembro(playwright, api, { rol: "gerente" });

    const { context, page } = await abrirComo(browser, gerente.storageState);

    try {
      const detalle = new DetalleProducto(page, producto);
      await detalle.ir();

      await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(5));
      await detalle.umbral.configurar("15");

      await expect(detalle.umbral.confirmacion).toHaveText(BloqueUmbral.CONFIRMACION);
      await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(15));
      expect(await umbralSegunApi(api, producto.id)).toBe(15);
    } finally {
      await context.close();
    }
  });

  test("el empleado ve el umbral pero no el formulario para cambiarlo", async ({
    api,
    playwright,
    browser,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "7" });
    // La segunda ubicacion no es parte del escenario sino la señal de abajo:
    // sin ella el link de transferir no se dibuja para nadie.
    await crearUbicacionViaApi(api, "Depósito");
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });

    const { context, page } = await abrirComo(browser, empleado.storageState);

    try {
      const detalle = new DetalleProducto(page, producto);
      await detalle.ir();

      // Lo ve porque lo necesita para saber que reponer.
      await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(7));

      // El formulario depende de los permisos, que llegan en otro pedido: hasta
      // entonces no se dibuja para nadie, asi que afirmar su ausencia antes de
      // tiempo pasaria aunque despues apareciera. El link de transferir esta
      // detras de la misma condicion (`resuelto && puede(...)`) y los tres roles
      // tienen `transferencia:create`: verlo es saber que los permisos ya
      // llegaron y que la ausencia del formulario es una decision, no una demora.
      await expect(page.getByTestId("detalle-transferir")).toBeVisible();
      await expect(detalle.umbral.formulario).toHaveCount(0);
      await expect(page.getByLabel("Umbral mínimo")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Guardar umbral" }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("si el producto se dio de baja con la pantalla abierta, avisa que ya no existe", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();
    await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(5));

    // Otra persona (o el mismo propietario en otra pestaña) lo da de baja
    // mientras esta pantalla sigue abierta. Es la unica forma de que el PUT
    // reciba un 404 desde la pantalla: un producto inexistente no se puede abrir.
    const baja = await api.delete(`/api/productos/${producto.id}`);
    expect(baja.status(), await baja.text()).toBe(204);

    await detalle.umbral.configurar("10");

    await expect(detalle.umbral.avisoGeneral).toHaveText("Ese producto ya no existe.");
    await expect(detalle.umbral.confirmacion).toHaveCount(0);
    // El valor mostrado no se toca: nada se guardo.
    await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(5));
  });

  test("si al gerente le quitan el permiso con la pantalla abierta, ve el aviso sin perder la sesión", async ({
    api,
    playwright,
    browser,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });
    const gerente = await sumarMiembro(playwright, api, { rol: "gerente" });

    const { context, page } = await abrirComo(browser, gerente.storageState);

    try {
      const detalle = new DetalleProducto(page, producto);
      await detalle.ir();
      await expect(detalle.umbral.formulario).toBeVisible();

      // El propietario lo baja a empleado por API mientras el gerente tiene la
      // pantalla abierta: el formulario que ve ya no le corresponde, y la unica
      // forma de enterarse es el 403 del backend al guardar.
      const { miembros } = await leerMiembros(api);
      const miembro = miembroPorCorreo(miembros, gerente.email);
      await cambiarRolViaApi(api, miembro.id, "empleado");

      await detalle.umbral.configurar("10");

      await expect(detalle.umbral.avisoPermiso).toBeVisible();
      await expect(detalle.umbral.confirmacion).toHaveCount(0);

      // Un 403 nunca cierra la sesion (HU-32): sigue en el detalle, no en el
      // login.
      await expect(page).toHaveURL(new RegExp(`/productos/${producto.id}$`));
      await expect(detalle.titulo).toBeVisible();

      // El aviso relee los permisos, asi que el formulario desaparece sin
      // recargar y queda lo que ve cualquier empleado: el valor, intacto.
      await expect(detalle.umbral.formulario).toHaveCount(0);
      await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(5));
      expect(await umbralSegunApi(api, producto.id)).toBe(5);
    } finally {
      await context.close();
    }
  });

  test.describe("convive con el formulario de productos de HU-9", () => {
    test("el umbral cargado en el alta es el que muestra el detalle", async ({
      page,
      api,
    }) => {
      const nuevo = productoValido({ umbralMinimo: "9", stockActual: "4" });

      const catalogo = new Catalogo(page);
      await catalogo.ir();
      await catalogo.abrirAlta();
      await catalogo.completar(catalogo.formularioAlta, nuevo);
      await catalogo.guardar(catalogo.formularioAlta);

      await expect(catalogo.formularioAlta).toHaveCount(0);
      await expect(catalogo.fila(nuevo)).toContainText("avisar con 9 o menos");

      // Se entra por «Ver stock», el camino real desde el catalogo.
      await catalogo.linkVerStock(nuevo).click();

      const detalle = new DetalleProducto(page, nuevo);
      await expect(detalle.titulo).toBeVisible();
      await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(9));
    });

    test("el detalle y la edición del catálogo leen y escriben el mismo umbral", async ({
      page,
      api,
    }) => {
      const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });

      // Del detalle hacia el catalogo: lo configurado en HU-16 aparece en el
      // listado y precargado en el formulario de edicion.
      const detalle = new DetalleProducto(page, producto);
      await detalle.ir();
      await detalle.umbral.configurar("15");
      await expect(detalle.umbral.confirmacion).toHaveText(BloqueUmbral.CONFIRMACION);

      const catalogo = new Catalogo(page);
      await catalogo.ir();
      await expect(catalogo.fila(producto)).toContainText("avisar con 15 o menos");

      await catalogo.botonEditar(producto).click();
      await expect(catalogo.formularioEdicion).toBeVisible();
      await expect(
        catalogo.formularioEdicion.getByLabel("Umbral mínimo"),
      ).toHaveValue("15");

      // Del catalogo hacia el detalle: editar el umbral junto con el resto de
      // la ficha, como siempre, se refleja en el bloque de HU-16.
      await catalogo.completar(catalogo.formularioEdicion, { umbralMinimo: "4" });
      await catalogo.guardar(catalogo.formularioEdicion);

      await expect(catalogo.formularioEdicion).toHaveCount(0);
      await expect(catalogo.fila(producto)).toContainText("avisar con 4 o menos");

      await detalle.ir();
      await expect(detalle.umbral.actual).toHaveText(BloqueUmbral.textoCon(4));
      expect(await umbralSegunApi(api, producto.id)).toBe(4);
    });
  });
});
