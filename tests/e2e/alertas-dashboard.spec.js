import { expect, test } from "../soporte/fixtures.js";
import { crearUbicacionViaApi, leerStock, stockEn } from "../soporte/datos.js";
import { abrirComo, crearOtroComercio, sumarMiembro } from "../soporte/equipo.js";
import {
  comprarViaApi,
  escenarioDeAlerta,
  fijarUmbralViaApi,
  leerAlertasViaApi,
  venderViaApi,
} from "../soporte/alertas.js";
import { PanelDeAlertas } from "./soporte/alertas.js";

/**
 * E2E de HU-17 — Alertas de reposicion en el dashboard (SCRUM-29 / SCRUM-130).
 *
 * Los criterios de la subtarea de testing son «generacion y resolucion de
 * alertas (cruce de umbral, sin duplicados, reposicion), consistencia con el
 * stock y aislamiento por comercio_id». Lo que agrega esta suite sobre lo que ya
 * esta cubierto en otro lado:
 *
 * - Los 1113 tests del Backend ya cubren la logica fina del anti-duplicado y la
 *   concurrencia, con acceso a la base y sin stack en el medio.
 * - Los 935 del Frontend dibujan cada estado del panel por separado con el
 *   service mockeado: vacio, pagina vacia, 401, 403, cada badge.
 *
 * Aca va el recorrido completo contra datos y backend reales: que un movimiento
 * de verdad atraviese el stack y haga aparecer —o desaparecer— la fila, que los
 * numeros de la pantalla cierren con el stock que devuelve la API, y que la
 * sesion por cookie a traves de Nginx no saltee el aislamiento por comercio.
 *
 * Las alertas se PROVOCAN por los dos disparadores reales (un movimiento de
 * HU-13, o `PUT /api/productos/:id/umbral` de HU-16); no se inserta ni una fila
 * a mano. Ver `tests/soporte/alertas.js`.
 *
 * ---------------------------------------------------------------------------
 * QUE NO SE PRUEBA ACA, Y POR QUE
 *
 * - LA PAGINA INEXISTENTE EN PANTALLA (`alertas-pagina-vacia`). La pagina vive
 *   en un `useState` y no en la URL —es deliberado: «meterle un ?pagina=2 al
 *   dashboard ensucia una URL»—, y `pagina-siguiente` esta `disabled` en la
 *   ultima. O sea que desde el navegador no hay forma de pedir una pagina que no
 *   existe. El borde de contrato se cubre por API en
 *   `tests/api/alertas.spec.js`; el estado dibujado, en los unitarios del
 *   Frontend. Lo que SI se hace en cada test de aca es afirmar su AUSENCIA, que
 *   es lo que distingue el vacio de verdad del hermano que se le parece.
 * - LOS BOTONES DE PAGINACION. El panel nunca manda `limite`, asi que es
 *   siempre el default de 50 y la navegacion solo se dibuja con
 *   `totalPaginas > 1`: harian falta 51 productos en falta creados de a uno
 *   contra Neon para ver un boton. Es el mismo costo por el que HU-21 dejo
 *   afuera los suyos.
 * - EL REFRESCO AUTOMATICO SIN RECARGAR. La cadencia es de 60 s contra un
 *   timeout de 45 s, y el refresco de fondo no mueve `aria-busy` a proposito.
 *   Los tests que necesitan ver datos nuevos recargan; que el panel se refresque
 *   solo lo cubren los unitarios del Frontend con temporizadores falsos.
 * - EL 401 Y EL 403. Cortan el polling y no se pueden provocar desde una sesion
 *   valida sin romperla a mano. El string literal del 401 va por API.
 */

test.describe("HU-17 — Alertas de reposición en el dashboard", () => {
  test("una salida que deja el stock por debajo del umbral genera la alerta", async ({
    page,
    api,
  }) => {
    const { producto, proveedor } = await escenarioDeAlerta(api, {
      umbral: 5,
      stockInicial: 20,
    });

    // El cruce: 20 − 16 = 4, que es menos que el umbral de 5. El faltante que
    // tiene que calcular el backend es 1.
    await venderViaApi(api, { productoId: producto.id, cantidad: 16 });

    const panel = new PanelDeAlertas(page);
    await panel.ir();

    // La fila esta, y es la unica: el comercio del test tiene un solo producto.
    await expect(panel.filas).toHaveCount(1);
    await expect(panel.fila(producto.id)).toBeVisible();
    await expect(panel.fila(producto.id)).toContainText(producto.nombre);

    // El faltante, por nombre accesible exacto: si fuera otro numero el locator
    // no encontraria nada, asi que el locator ES la asercion.
    await expect(
      panel.faltanteDe(producto.id, { faltante: 1 }),
    ).toBeVisible();
    // Y no es el hermano que se le parece: 4 no es justo el minimo.
    await expect(panel.faltanteCeroDe(producto.id)).toHaveCount(0);

    // «Consistencia con el stock»: los dos lados de la comparacion, en el mismo
    // label. La pantalla no puede decir un stock y la API otro.
    await expect(
      panel.stockDe(producto.id, { stock: 4, umbral: 5 }),
    ).toBeVisible();

    const detalle = await leerStock(api, producto.id);
    expect(
      stockEn(detalle, "Principal"),
      "la pantalla dice 4: la API tiene que decir lo mismo",
    ).toBe(4);

    // Tiene a quien pedirle, y es el proveedor asociado. Sin «otros»: hay uno.
    await expect(panel.proveedorSugeridoDe(producto.id)).toContainText(
      proveedor.nombre,
    );
    await expect(panel.sinProveedorDe(producto.id)).toHaveCount(0);
    await expect(panel.otrosProveedoresDe(producto.id)).toHaveCount(0);

    // Recien generada, asi que todavia no empeoro.
    await expect(panel.bajoDesdeElAvisoDe(producto.id)).toHaveCount(0);
    // La fecha se muestra; no se compara el texto, que lo formatea el navegador
    // a partir de un `generadaEn` que pone la base.
    await expect(panel.generadaEnDe(producto.id)).toBeVisible();

    // Ninguno de los estados excluyentes esta puesto.
    await expect(panel.vacio).toHaveCount(0);
    await expect(panel.paginaVacia).toHaveCount(0);
    await expect(panel.error).toHaveCount(0);
    await expect(panel.contador).toContainText("1 producto para reponer");
  });

  test("una segunda salida sobre el mismo producto no duplica la fila", async ({
    page,
    api,
  }) => {
    const { producto } = await escenarioDeAlerta(api, {
      umbral: 5,
      stockInicial: 20,
    });

    await venderViaApi(api, { productoId: producto.id, cantidad: 16 });

    const panel = new PanelDeAlertas(page);
    await panel.ir();
    await expect(panel.filas).toHaveCount(1);

    // La segunda salida vuelve a cruzar un umbral que ya estaba cruzado: 4 → 3.
    await venderViaApi(api, { productoId: producto.id, cantidad: 1 });

    await page.reload();
    await panel.esperarCarga();

    // Sigue habiendo UNA fila. Es el criterio «sin duplicados» visto desde la
    // pantalla: el backend reusa la alerta abierta en vez de abrir otra.
    await expect(panel.filas).toHaveCount(1);
    await expect(panel.contador).toContainText("1 producto para reponer");

    // Y es la MISMA alerta, no una nueva con los numeros al dia — que es lo que
    // un duplicado disimulado se veria exactamente igual. La prueba es
    // `alerta-bajo-desde-el-aviso`: se dibuja solo cuando
    // `stockActual < stockAlGenerar`, y `stockAlGenerar` quedo en 4 al generarse
    // la primera. Una alerta nueva lo tendria en 3 y esta linea NO apareceria.
    await expect(panel.bajoDesdeElAvisoDe(producto.id)).toBeVisible();
    await expect(panel.bajoDesdeElAvisoDe(producto.id)).toContainText("4");

    // Los valores vivos se movieron con el stock: el faltante ahora es 2.
    await expect(panel.faltanteDe(producto.id, { faltante: 2 })).toBeVisible();
    await expect(
      panel.stockDe(producto.id, { stock: 3, umbral: 5 }),
    ).toBeVisible();
    // El faltante viejo ya no esta: si el panel mostrara las dos, esto caeria.
    await expect(panel.faltanteDe(producto.id, { faltante: 1 })).toHaveCount(0);
  });

  test("una entrada por encima del umbral resuelve la alerta", async ({
    page,
    api,
  }) => {
    const { producto } = await escenarioDeAlerta(api, {
      umbral: 5,
      stockInicial: 20,
    });

    await venderViaApi(api, { productoId: producto.id, cantidad: 16 });

    const panel = new PanelDeAlertas(page);
    await panel.ir();
    await expect(panel.fila(producto.id)).toBeVisible();

    // La reposicion: 4 + 10 = 14, por encima del umbral de 5.
    await comprarViaApi(api, { productoId: producto.id, cantidad: 10 });

    // Se recarga en vez de esperar el refresco automatico: la cadencia es de
    // 60 s contra un timeout de 45 s, y el refresco de fondo no mueve
    // `aria-busy`, asi que no hay nada que esperar sin atarse al tick. Que el
    // panel se actualice solo lo cubren los unitarios del Frontend.
    await page.reload();
    await panel.esperarCarga();

    // La alerta se resolvio sola, sin que nadie la descarte: no existe el boton
    // de descartar, y es a proposito — lo que resuelve una alerta es reponer.
    await expect(panel.fila(producto.id)).toHaveCount(0);
    await expect(panel.filas).toHaveCount(0);

    // Y el panel queda en el vacio de verdad, no en el hermano que se le parece.
    await expect(panel.vacio).toBeVisible();
    await expect(panel.paginaVacia).toHaveCount(0);
    await expect(panel.error).toHaveCount(0);
    // El contador solo existe cuando hay algo que contar.
    await expect(panel.contador).toHaveCount(0);

    // La contraprueba por API: la lista esta vacia porque se repuso, no porque
    // el endpoint dejo de contestar.
    const { alertas, paginacion } = await leerAlertasViaApi(api);
    expect(alertas).toEqual([]);
    expect(paginacion.total).toBe(0);
  });

  test("un producto justo en el mínimo aparece igual, con su propio mensaje", async ({
    page,
    api,
  }) => {
    const { producto } = await escenarioDeAlerta(api, {
      umbral: 5,
      stockInicial: 20,
    });

    // Exactamente en el umbral: 20 − 15 = 5. El backend evalua `stock <= umbral`,
    // asi que alcanzar el minimo ya es estar en falta.
    await venderViaApi(api, { productoId: producto.id, cantidad: 15 });

    const panel = new PanelDeAlertas(page);
    await panel.ir();

    // Lo que esta HU promete y es facil de romper: la fila APARECE.
    await expect(panel.filas).toHaveCount(1);
    await expect(panel.fila(producto.id)).toBeVisible();

    // Con el mensaje del caso cero, y sin el del faltante positivo. Son dos
    // testids porque dicen cosas distintas —«compra 7» y «estas al limite»— y
    // afirmar uno sin negar el otro no distinguiria nada.
    await expect(panel.faltanteCeroDe(producto.id)).toBeVisible();
    await expect(panel.faltanteCeroDe(producto.id)).toContainText(
      "Está justo en el mínimo",
    );
    await expect(panel.fila(producto.id).getByTestId("alerta-faltante")).toHaveCount(
      0,
    );

    // Un faltante de 0 no se muestra como «Faltan 0»: ese label no existe.
    await expect(panel.faltanteDe(producto.id, { faltante: 0 })).toHaveCount(0);

    await expect(
      panel.stockDe(producto.id, { stock: 5, umbral: 5 }),
    ).toBeVisible();
    await expect(panel.vacio).toHaveCount(0);
    await expect(panel.paginaVacia).toHaveCount(0);
  });

  test("un producto sin proveedor asociado aparece igual, avisando que no tiene", async ({
    page,
    api,
  }) => {
    const { producto } = await escenarioDeAlerta(api, {
      umbral: 5,
      stockInicial: 20,
      conProveedor: false,
      nombre: "Lavandina",
    });

    await venderViaApi(api, { productoId: producto.id, cantidad: 16 });

    const panel = new PanelDeAlertas(page);
    await panel.ir();

    // Esconder la alerta de un producto sin proveedor seria lo peor que podria
    // hacer: es justo el que hay que resolver a mano.
    await expect(panel.filas).toHaveCount(1);
    await expect(panel.fila(producto.id)).toBeVisible();
    await expect(panel.faltanteDe(producto.id, { faltante: 1 })).toBeVisible();

    await expect(panel.sinProveedorDe(producto.id)).toBeVisible();
    await expect(panel.proveedorSugeridoDe(producto.id)).toHaveCount(0);
    await expect(panel.otrosProveedoresDe(producto.id)).toHaveCount(0);

    // Y no hay ningun `tel:` ni `mailto:` sueltos en la fila, que es como se
    // veria un sugerido a medias.
    await expect(panel.fila(producto.id).locator('a[href^="tel:"]')).toHaveCount(0);
    await expect(
      panel.fila(producto.id).locator('a[href^="mailto:"]'),
    ).toHaveCount(0);

    // El contrato dice que `proveedorSugerido` puede ser null; esta es la
    // contraprueba de que la pantalla llego a ese caso y no a otro.
    const { alertas } = await leerAlertasViaApi(api);
    expect(alertas).toHaveLength(1);
    expect(alertas[0].proveedorSugerido).toBeNull();
    expect(alertas[0].proveedores).toEqual([]);
  });

  test("el stock repartido en dos ubicaciones se desglosa por ubicación", async ({
    page,
    api,
  }) => {
    // El alta mete los 20 en «Principal», que es la unica que existe entonces.
    const { producto, principal } = await escenarioDeAlerta(api, {
      umbral: 10,
      stockInicial: 20,
      nombre: "Arroz",
    });

    const deposito = await crearUbicacionViaApi(api, "Depósito");

    // Desde aca hay dos ubicaciones, asi que todos los movimientos llevan la
    // suya: con mas de una el backend la exige.
    await comprarViaApi(api, {
      productoId: producto.id,
      cantidad: 3,
      ubicacionId: deposito.id,
    });
    await venderViaApi(api, {
      productoId: producto.id,
      cantidad: 15,
      ubicacionId: principal.id,
    });

    // Queda 5 en Principal y 3 en Depósito: total 8, umbral 10, faltante 2.
    // Los numeros no son iguales ni suman el total por casualidad, asi que un
    // movimiento aplicado al estante equivocado no puede pasar en verde.
    const panel = new PanelDeAlertas(page);
    await panel.ir();

    await expect(panel.filas).toHaveCount(1);
    await expect(panel.faltanteDe(producto.id, { faltante: 2 })).toBeVisible();
    await expect(
      panel.stockDe(producto.id, { stock: 8, umbral: 10 }),
    ).toBeVisible();

    // El desglose completo: el umbral es por producto y se compara contra el
    // total del comercio, asi que mostrar una sola ubicacion diria que el resto
    // no esta.
    await expect(panel.ubicacionesDe(producto.id)).toBeVisible();
    await expect(panel.ubicacionesChipsDe(producto.id)).toHaveCount(2);
    await expect(
      panel.ubicacionDe(producto.id, { nombre: "Principal", cantidad: 5 }),
    ).toBeVisible();
    await expect(
      panel.ubicacionDe(producto.id, { nombre: "Depósito", cantidad: 3 }),
    ).toBeVisible();
    await expect(panel.sinUbicacionesDe(producto.id)).toHaveCount(0);

    // Contra la API, y POR UBICACION: `total` suma las dos y daria el mismo 8
    // con los 5 y los 3 invertidos.
    const detalle = await leerStock(api, producto.id);
    expect(stockEn(detalle, "Principal")).toBe(5);
    expect(stockEn(detalle, "Depósito")).toBe(3);
  });

  test("sin nada por debajo del mínimo el panel lo dice, y un umbral en 0 no alerta", async ({
    page,
    api,
  }) => {
    // Stock 0 y umbral 0. Numericamente `0 <= 0` es verdadero, pero
    // `umbralMinimo = 0` significa «sin umbral» y no tiene que alertar nunca.
    // Por eso el vacio se prueba con ESTE producto y no con un comercio pelado:
    // asi el test custodia la regla en vez de constatar que la nada esta vacia.
    const { producto } = await escenarioDeAlerta(api, {
      umbral: 0,
      stockInicial: 0,
      nombre: "Sal",
    });

    const panel = new PanelDeAlertas(page);
    await panel.ir();

    await expect(panel.vacio).toBeVisible();
    // El hermano que se le parece y significa lo contrario.
    await expect(panel.paginaVacia).toHaveCount(0);
    await expect(panel.error).toHaveCount(0);
    await expect(panel.cargando).toHaveCount(0);
    await expect(panel.filas).toHaveCount(0);
    await expect(panel.contador).toHaveCount(0);

    const { paginacion } = await leerAlertasViaApi(api);
    expect(paginacion.total).toBe(0);
    // Sin compras en el periodo `totalPaginas` es 0 y la navegacion no existe.
    await expect(panel.paginacion).toHaveCount(0);

    // LA CONTRAPRUEBA, que es lo que hace que lo de arriba pruebe la regla del 0
    // y no simplemente «el panel sabe estar vacio»: con el MISMO stock de 0 y el
    // umbral en 1, la alerta aparece. El segundo disparador de la HU, sin mover
    // una sola unidad.
    await fijarUmbralViaApi(api, producto.id, 1);

    await page.reload();
    await panel.esperarCarga();

    await expect(panel.filas).toHaveCount(1);
    await expect(panel.fila(producto.id)).toBeVisible();
    await expect(panel.faltanteDe(producto.id, { faltante: 1 })).toBeVisible();
    await expect(panel.vacio).toHaveCount(0);
  });

  test("el empleado ve el panel de alertas", async ({
    api,
    browser,
    playwright,
  }) => {
    const { producto } = await escenarioDeAlerta(api, {
      umbral: 5,
      stockInicial: 20,
    });

    await venderViaApi(api, { productoId: producto.id, cantidad: 16 });

    // `alerta.read` lo tienen los TRES roles, asi que el empleado entra. Es la
    // parte que el fail-closed del Frontend puede romper sin que el backend se
    // entere: el panel solo se dibuja si `GET /api/configuracion` trajo el
    // permiso, asi que una respuesta sin `permisos` lo haria desaparecer entero.
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const { context, page } = await abrirComo(browser, empleado.storageState);

    try {
      const panel = new PanelDeAlertas(page);
      await panel.ir();

      await expect(panel.filas).toHaveCount(1);
      await expect(panel.fila(producto.id)).toBeVisible();
      await expect(panel.faltanteDe(producto.id, { faltante: 1 })).toBeVisible();

      // Lo que NO tiene que pasar: que el panel no se dibuje, o que aparezca el
      // aviso de permiso.
      await expect(panel.contenedor).toBeVisible();
      await expect(panel.error).toHaveCount(0);
      await expect(page.getByTestId("aviso-permiso")).toHaveCount(0);
      await expect(page.getByTestId("aviso-sesion")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("un comercio no ve las alertas de otro", async ({
    api,
    browser,
    playwright,
  }) => {
    const { producto } = await escenarioDeAlerta(api, {
      umbral: 5,
      stockInicial: 20,
    });

    await venderViaApi(api, { productoId: producto.id, cantidad: 16 });

    const otro = await crearOtroComercio(playwright);

    try {
      // El otro comercio tiene su propia alerta, con numeros distintos. Sin esto
      // el test no distinguiria «no ve lo ajeno» de «no ve nada».
      const suyo = await escenarioDeAlerta(otro.api, {
        umbral: 8,
        stockInicial: 30,
        nombre: "Azúcar",
      });
      await venderViaApi(otro.api, { productoId: suyo.producto.id, cantidad: 25 });

      const { context, page } = await abrirComo(browser, otro.storageState);

      try {
        const panel = new PanelDeAlertas(page);
        await panel.ir();

        // Ve lo suyo, y SOLO lo suyo: una fila, y es la de su producto.
        await expect(panel.filas).toHaveCount(1);
        expect(await panel.idsVisibles()).toEqual([String(suyo.producto.id)]);
        await expect(
          panel.faltanteDe(suyo.producto.id, { faltante: 3 }),
        ).toBeVisible();

        // El producto del comercio del test no aparece por ningun lado: ni la
        // fila ni el nombre. No hay URL con la que forzarlo —el panel no toma
        // ids— asi que el aislamiento se verifica sobre lo que lista.
        await expect(panel.fila(producto.id)).toHaveCount(0);
        await expect(panel.contenedor).not.toContainText(producto.nombre);
      } finally {
        await context.close();
      }

      // Y desde la API del otro comercio tampoco: la cookie no alcanza para ver
      // lo ajeno aunque entre por el mismo Nginx.
      const suyas = await leerAlertasViaApi(otro.api);
      expect(suyas.paginacion.total).toBe(1);
      expect(suyas.alertas.map((alerta) => alerta.producto.id)).toEqual([
        suyo.producto.id,
      ]);
    } finally {
      await otro.api.dispose();
    }

    // La contraprueba: la alerta del comercio del test sigue entera. Un
    // aislamiento que ademas borrara datos pasaria las aserciones de arriba.
    const mias = await leerAlertasViaApi(api);
    expect(mias.paginacion.total).toBe(1);
    expect(mias.alertas[0].producto.id).toBe(producto.id);
    expect(mias.alertas[0].faltanteHastaElUmbral).toBe(1);
  });

  test("las ubicaciones que quedaron en cero no esconden la alerta", async ({
    page,
    api,
  }) => {
    // El borde del desglose: el producto se quedo sin nada en ningun lado. Es el
    // caso mas urgente de todos y el que un filtro por `cantidad > 0` mal puesto
    // dejaria sin mostrar donde buscar.
    const { producto } = await escenarioDeAlerta(api, {
      umbral: 5,
      stockInicial: 20,
      nombre: "Yerba",
    });

    await venderViaApi(api, { productoId: producto.id, cantidad: 20 });

    const panel = new PanelDeAlertas(page);
    await panel.ir();

    await expect(panel.filas).toHaveCount(1);
    await expect(panel.faltanteDe(producto.id, { faltante: 5 })).toBeVisible();
    await expect(
      panel.stockDe(producto.id, { stock: 0, umbral: 5 }),
    ).toBeVisible();

    // El cartel de que no queda nada, y NO el desglose. El backend filtra las
    // filas en cero (`cantidad <> 0` en `ubicacionesDeProductos`) porque una
    // ubicacion vacia no ayuda a ir a buscar la mercaderia, asi que «Principal»
    // —que conserva su fila en `stock` con cantidad 0— no tiene que aparecer
    // como si todavia hubiera algo ahi.
    await expect(panel.sinUbicacionesDe(producto.id)).toBeVisible();
    await expect(panel.ubicacionesDe(producto.id)).toHaveCount(0);
    await expect(panel.ubicacionesChipsDe(producto.id)).toHaveCount(0);

    // La fila de «Principal» sigue existiendo en cero: es exactamente la que el
    // desglose tiene que omitir. Sin esta linea el test pasaria tambien si el
    // producto no tuviera ninguna fila de stock, que es otro escenario.
    const detalle = await leerStock(api, producto.id);
    expect(stockEn(detalle, "Principal")).toBe(0);
  });
});
