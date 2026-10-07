import { expect, test } from "./soporte/base.js";
import { Accesos } from "./soporte/accesos.js";
import { Recomendaciones } from "./soporte/recomendaciones.js";
import { contarPedidosDeRecomendaciones } from "./soporte/red.js";
import { UBICACION_POR_DEFECTO } from "./soporte/movimientos.js";
import { abrirComo, sumarMiembro } from "../soporte/equipo.js";
import {
  crearProductoViaApi,
  leerUbicaciones,
  registrarMovimientoViaApi,
  ubicacionPorNombre,
} from "../soporte/datos.js";
import { BASE_URL } from "../soporte/entorno.js";

/**
 * E2E de HU-27 — recomendaciones proactivas (SCRUM-39 / Testing SCRUM-106).
 *
 * QUE CUBRE ESTA CAPA Y NINGUNA OTRA
 *
 * El circuito completo: la sesion por cookie que emitio el sign-up, Nginx en el
 * medio, el `requirePermission({ asistente: ["recomendaciones"] })` real del
 * middleware —no mockeado— y el analisis corriendo contra datos de verdad en
 * Postgres. Los 635 unitarios del Frontend ya cubren los tres tipos de tarjeta
 * en escritorio y celular, los tres valores de `modo`, el link navegando, el 403
 * sin redirigir al login y cero errores de JS, todo con la API mockeada. Lo que
 * nadie verificaba es que el escenario que la pantalla dibuja SALGA de datos
 * reales: que un producto con stock 0 y umbral 3 produzca efectivamente una
 * tarjeta de prioridad alta del otro lado del stack.
 *
 * Por eso la mayor parte de este archivo es montaje, y el montaje es el aporte:
 * las recetas de abajo no se deducen del contrato, salen de leer `analizar()` y
 * las dos consultas que lo alimentan.
 *
 * `modo` ES DETERMINISTA EN ESTE STACK, Y NO ES UNA FALLA
 *
 * `docker-compose.yml` vacia la key del AI Gateway (una sola para los tres
 * integrantes, US$ 5 por mes), asi que aca NUNCA se ve `modo: "ia"`:
 *
 *   lista con contenido  ->  "limitado"       -> el aviso de degradacion SIEMPRE
 *   lista vacia          ->  "sin_novedades"  -> SIN aviso de degradacion
 *
 * El aviso aparece siempre que haya al menos una tarjeta, y eso es correcto: no
 * hay modelo que redacte el resumen. El caso «ia sin aviso» no se puede montar
 * en este stack y no se intenta — lo cubren los unitarios del Frontend.
 *
 * LO QUE A PROPOSITO NO SE AFIRMA
 *
 * - El contenido de `texto` y `porQue`: son plantillas del backend y van a
 *   cambiar. Se afirma el contrato (la tarjeta de ese tipo existe, su
 *   `data-prioridad`, si lleva link y a donde).
 * - El `resumen`: solo que no esta vacio. Esta cacheado 10 minutos del lado del
 *   servidor y comparte cupo con HU-26/HU-28, asi que dos refrescos seguidos
 *   pueden traer el mismo parrafo. No es un bug.
 * - Que la hora cambie al refrescar: se muestra con precision de minutos, asi
 *   que dos clics en el mismo minuto dan la misma. El refresco se prueba
 *   contando los GET, que es lo unico que no depende del cache ni del reloj.
 */

/**
 * Cuantos dias atras se corre el alta del producto quieto.
 *
 * Tiene que ser mas que la ventana de analisis, que son 30 dias (el default de
 * `RECOMENDACIONES_DIAS`, que `docker-compose.yml` deja sin pisar a proposito).
 * 45 da margen de sobra sin acercarse al maximo de 90.
 */
const DIAS_FUERA_DE_LA_VENTANA = 45;

/**
 * Los dos escenarios de reposicion, que se distinguen SOLO por el stock.
 *
 * El umbral tiene que ser > 0 en los dos: `analizar()` filtra los de umbral 0
 * porque ahi no hay minimo configurado —es el default del schema y lo que deja
 * la importacion de HU-7 con la celda vacia—, asi que un fixture armado por
 * importacion nunca produciria una tarjeta de reponer.
 *
 * - `alta`:  stock EXACTAMENTE 0. Es el unico caso que da prioridad alta
 *            (`fila.enStock === 0`); el negocio ya esta perdiendo ventas.
 * - `media`: stock por encima de 0 y en el umbral o por debajo. Pide la misma
 *            accion, pero todavia hay con que vender.
 */
const REPOSICION = {
  alta: { stockActual: "0", umbralMinimo: "3" },
  media: { stockActual: "3", umbralMinimo: "5" },
};

/** La ubicacion que crea sola el alta del primer producto del comercio. */
async function principalDe(api) {
  return ubicacionPorNombre(await leerUbicaciones(api), UBICACION_POR_DEFECTO);
}

/**
 * Deja al comercio con historial suficiente para que se pueda hablar de
 * rotacion, y devuelve el producto que uso para lograrlo.
 *
 * Es la precondicion de TRES escenarios (`reponer` en sus dos prioridades,
 * `baja_rotacion` y `sin_novedades`): con menos ventas que
 * `RECOMENDACIONES_VENTAS_MINIMAS`, `analizar()` cierra la compuerta y devuelve
 * `sin_historial` en lugar de cualquier analisis de rotacion. Es decir que sin
 * esto, los cuatro tests darian la MISMA tarjeta y ninguno probaria lo suyo.
 *
 * Tres cosas de este producto, y las tres son necesarias:
 *
 * - El movimiento es `tipo: "venta"` y no `compra` ni `ajuste`. La consulta
 *   filtra `eq(movimiento.tipo, "venta")`, asi que es el unico tipo que corre la
 *   compuerta. El `ajuste` del stock inicial no cuenta para nada. Y no lleva
 *   motivo: eso lo exige HU-15 para merma y ajuste, no para una venta.
 * - Queda MUY por encima de su umbral (19 contra 5), asi que el producto no se
 *   cuela como tarjeta de reponer y ensucia el conteo del test que lo llamo.
 * - Se da de alta hoy, asi que su `created_at` lo deja afuera de los candidatos
 *   de rotacion. O sea que tampoco puede salir como baja rotacion. Es puro
 *   combustible para `ventasDelComercio`.
 *
 * Con `RECOMENDACIONES_VENTAS_MINIMAS: "1"` en el compose alcanza una sola
 * venta; con el valor de produccion (3) harian falta tres viajes mas a Neon por
 * test para llegar al mismo escenario.
 */
async function habilitarElAnalisisDeRotacion(api) {
  const sano = await crearProductoViaApi(api, {
    umbralMinimo: "5",
    stockActual: "20",
  });

  const principal = await principalDe(api);

  await registrarMovimientoViaApi(api, {
    productoId: sano.id,
    tipo: "venta",
    cantidad: 1,
    ubicacionId: principal.id,
  });

  return sano;
}

test.describe("HU-27 — Recomendaciones proactivas", () => {
  test.describe("Los tipos de sugerencia, montados con datos reales", () => {
    /**
     * El default de un comercio nuevo, y el que mas se ve en desarrollo.
     *
     * No hace falta montar NADA: sin ventas, `rotacion.ventasDelComercio` es 0,
     * queda por debajo de cualquier piso —el de produccion y el del compose— y
     * `analizar()` devuelve `sin_historial` sola. Ojo con leerlo como "estado
     * vacio": es contenido, y por eso lleva el aviso de degradacion.
     *
     * Se corre con los dos roles que tienen el permiso. El gerente no es un
     * caso de adorno: es el que HU-32 separo de `consultar`, asi que es la celda
     * de la matriz que mas facil se rompe sin que nadie se entere.
     */
    for (const rol of ["propietario", "gerente"]) {
      test(`el ${rol} ve que todavia no hay ventas suficientes`, async ({
        page,
        api,
        playwright,
        browser,
      }) => {
        const propio = rol === "propietario";
        const persona = propio
          ? null
          : await sumarMiembro(playwright, api, { rol });

        const { context, page: pagina } = propio
          ? { context: null, page }
          : await abrirComo(browser, persona.storageState);

        try {
          const recomendaciones = new Recomendaciones(pagina);
          await recomendaciones.ir();

          await expect(recomendaciones.titulo).toBeVisible();
          await expect(
            recomendaciones.tarjetas,
            `el ${rol} tendría que ver exactamente una sugerencia`,
          ).toHaveCount(1);

          const tarjeta = recomendaciones.tarjeta("sin_historial");
          await expect(tarjeta).toBeVisible();
          await expect(tarjeta).toHaveAttribute("data-prioridad", "baja");

          // Habla del comercio entero (`producto: null`), asi que no hay ficha
          // a la que ir y la tarjeta no lleva accion.
          await expect(tarjeta.getByRole("link")).toHaveCount(0);

          await expect(recomendaciones.resumen).not.toBeEmpty();
          await expect(recomendaciones.generadoEn).toBeVisible();

          // Hay contenido, asi que el resumen salio de plantilla. Ver el
          // encabezado: es lo correcto en este stack, no una falla.
          await expect(recomendaciones.avisoLimitado).toBeVisible();

          // Y no es el estado vacio, que dice algo distinto.
          await expect(recomendaciones.vacio).toHaveCount(0);
        } finally {
          await context?.close();
        }
      });
    }

    /**
     * Las dos prioridades de reposicion, que es el ejemplo que da la Historia de
     * Usuario («avisame que me falta reponer»).
     *
     * Un test por prioridad y no los dos en uno: son dos productos que no pueden
     * convivir en el mismo comercio sin que el conteo deje de significar algo.
     * Con `toHaveCount(1)` la asercion es «esta tarjeta y ninguna otra», que es
     * la que caza el escenario montado mal.
     */
    for (const [prioridad, campos] of Object.entries(REPOSICION)) {
      test(`un producto bajo el mínimo sale como reponer con prioridad ${prioridad}`, async ({
        page,
        api,
      }) => {
        await habilitarElAnalisisDeRotacion(api);
        const falta = await crearProductoViaApi(api, campos);

        const recomendaciones = new Recomendaciones(page);
        await recomendaciones.ir();

        await expect(
          recomendaciones.tarjetas,
          "solo el producto bajo el mínimo tendría que generar una sugerencia",
        ).toHaveCount(1);

        const tarjeta = recomendaciones.tarjeta("reponer");
        await expect(tarjeta).toBeVisible();
        await expect(tarjeta).toHaveAttribute("data-prioridad", prioridad);

        // El nombre se afirma sobre el `<li>` entero y no con un `getByText`:
        // aparece tres veces en la tarjeta (el titulo, el `texto` y el
        // `aria-label` del link), asi que un `getByText` caeria por strict mode.
        await expect(tarjeta).toContainText(falta.nombre);

        // La accion directa, acotada a la tarjeta (ver `linkVerStock` en el page
        // object: el catalogo usa el mismo nombre accesible a proposito).
        await expect(
          recomendaciones.linkVerStock("reponer", falta),
        ).toHaveAttribute("href", `/productos/${falta.id}`);

        await expect(recomendaciones.avisoLimitado).toBeVisible();
      });
    }

    /**
     * Baja rotacion: el producto que inmoviliza plata.
     *
     * ES EL ESCENARIO MAS CARO DE MONTAR, y la razon esta en el fixture `base`:
     * `rotacionDeProductos` solo mira productos que ya existian cuando empezo la
     * ventana, y `created_at` es `defaultNow()` sin forma de pasarlo por API.
     * Sin el UPDATE que lo envejece, este caso no se puede montar de ninguna
     * manera desde HTTP. Lo que se fabrica es la antiguedad del alta y nada mas:
     * el stock, las ventas y el analisis son de verdad.
     *
     * `umbralMinimo: "0"` tampoco es una eleccion libre, es la unica que
     * funciona. Con un umbral > 0 y stock 10 el producto entraria igual al
     * analisis, pero el dedupe lo resolveria como `reponer` si quedara bajo el
     * minimo —gana la reposicion, porque el umbral lo fijo la persona a
     * proposito— y las dos tarjetas del mismo producto no pueden coexistir. Con
     * umbral 0 no hay minimo configurado, `analizar()` lo deja fuera del Set de
     * dedupe explicitamente, y «no se esta vendiendo» no contradice nada.
     */
    test("un producto con stock que no se vendió en la ventana sale como baja rotación", async ({
      page,
      api,
      base,
    }) => {
      await habilitarElAnalisisDeRotacion(api);

      const quieto = await crearProductoViaApi(api, {
        umbralMinimo: "0",
        stockActual: "10",
      });

      await base.envejecerProducto(quieto.id, DIAS_FUERA_DE_LA_VENTANA);

      const recomendaciones = new Recomendaciones(page);
      await recomendaciones.ir();

      await expect(
        recomendaciones.tarjetas,
        "solo el producto parado tendría que generar una sugerencia",
      ).toHaveCount(1);

      const tarjeta = recomendaciones.tarjeta("baja_rotacion");
      await expect(tarjeta).toBeVisible();
      await expect(tarjeta).toHaveAttribute("data-prioridad", "media");
      await expect(tarjeta).toContainText(quieto.nombre);

      // La categoria es el unico campo de `datos` que la pantalla muestra, y es
      // dato nuestro, no plantilla: sirve para confirmar que `datos` llego
      // completo y no solo los textos.
      await expect(tarjeta).toContainText(quieto.categoria);

      await expect(
        recomendaciones.linkVerStock("baja_rotacion", quieto),
      ).toHaveAttribute("href", `/productos/${quieto.id}`);

      await expect(recomendaciones.avisoLimitado).toBeVisible();
    });

    /**
     * El comercio ordenado: nada bajo el minimo y todo moviendose.
     *
     * Es el unico caso en que la lista viene vacia, y el unico en que NO
     * corresponde el aviso de degradacion. Esa combinacion —estado vacio sin
     * aviso— es el punto del test: `sin_novedades` existe justamente para que
     * `limitado` siga significando una sola cosa, y si el backend volviera a
     * mandar `limitado` por no tener key, la pantalla pondria una alarma donde
     * no hay ninguna.
     *
     * El producto sano del montaje queda en 19 con umbral 5, y su alta de hoy lo
     * saca de los candidatos de rotacion: no hay nada que recomendar sobre el.
     */
    test("un comercio ordenado no recibe sugerencias y tampoco el aviso de degradación", async ({
      page,
      api,
    }) => {
      await habilitarElAnalisisDeRotacion(api);

      const recomendaciones = new Recomendaciones(page);
      await recomendaciones.ir();

      await expect(recomendaciones.vacio).toBeVisible();

      // Con la lista vacia el `<ul>` no se renderiza: no es una lista de cero
      // elementos, directamente no esta.
      await expect(recomendaciones.lista).toHaveCount(0);
      await expect(recomendaciones.tarjetas).toHaveCount(0);

      // La asercion que sostiene todo el caso.
      await expect(
        recomendaciones.avisoLimitado,
        "«sin_novedades» no es una degradación: no corresponde el aviso",
      ).toHaveCount(0);

      // Y el resumen igual explica por que no hay nada, en vez de dejar la
      // seccion muda.
      await expect(recomendaciones.resumen).not.toBeEmpty();
    });
  });

  test.describe("El refresco manual", () => {
    /**
     * Que «Actualizar» vuelva a pedir de verdad.
     *
     * EL ANCLA ES EL CONTEO DE PEDIDOS, y vale explicar por que no es ninguna de
     * las dos cosas que parecen obvias:
     *
     * - El `resumen` esta cacheado 10 minutos del lado del servidor, asi que dos
     *   refrescos seguidos devuelven el mismo parrafo.
     * - La hora se muestra con precision de minutos, asi que dos clics dentro
     *   del mismo minuto dan la misma hora.
     *
     * Anclarse en cualquiera de las dos daria un test que falla cuando el
     * sistema funciona bien. Los GET, en cambio, se cuentan sin ambiguedad.
     *
     * Se compara el DELTA y no el total: cuantos pedidos hace la carga inicial
     * es un detalle de implementacion del Frontend (un StrictMode o un
     * `useEffect` de mas lo cambiarian sin romper nada de lo que esta HU
     * promete). Lo que el test afirma es que el click agrega exactamente uno.
     */
    test("«Actualizar» vuelve a pedir las sugerencias y no rompe lo que ya se veía", async ({
      page,
    }) => {
      // ANTES del `goto`: enganchado despues, la llamada de la carga inicial ya
      // paso y el array arrancaria vacio sin que eso signifique nada.
      const pedidos = contarPedidosDeRecomendaciones(page);

      const recomendaciones = new Recomendaciones(page);
      const accesos = new Accesos(page);

      // Sin montaje: el comercio vacio da una tarjeta `sin_historial`, que es
      // todo lo que hace falta para que el boton exista.
      await recomendaciones.ir();

      const antes = pedidos.length;
      expect(
        antes,
        "la carga inicial tendría que haber pedido las sugerencias",
      ).toBeGreaterThan(0);

      // El boton existe recien ahora: antes de la primera respuesta no hay nada
      // que refrescar y el Frontend no lo monta.
      await expect(recomendaciones.botonActualizar).toHaveText("Actualizar");

      await recomendaciones.actualizar();

      expect(
        pedidos.length - antes,
        "el click en «Actualizar» tendría que disparar exactamente un pedido más",
      ).toBe(1);

      // Y lo que ya se veia sigue ahi: los datos viejos no se vacian mientras se
      // refresca, y el refresco no dejo ningun error en pantalla.
      await expect(recomendaciones.tarjeta("sin_historial")).toBeVisible();
      await expect(recomendaciones.generadoEn).toBeVisible();
      await expect(accesos.avisoGeneral).toHaveCount(0);
      await expect(accesos.avisoSesion).toHaveCount(0);
      await expect(accesos.avisoPermiso).toHaveCount(0);
    });
  });

  test.describe("El rol que no tiene el permiso", () => {
    /**
     * El empleado, que tiene `asistente:consultar` pero no
     * `asistente:recomendaciones`.
     *
     * La asercion que importa no es «no ve la seccion» sino «NO PIDE LOS DATOS».
     * Sin contar los pedidos, «no se ve» se cumpliria igual si la pantalla
     * pidiera las recomendaciones, recibiera un 403 y escondiera el resultado —
     * que es otra cosa y es peor: seria mandarle al backend un pedido que ya se
     * sabe que va a ser rechazado, y dejar que la pantalla parpadee mientras
     * tanto.
     *
     * `irAInicio()` es el ancla correcta y no un `goto` pelado: espera a que los
     * permisos esten resueltos (`acceso-productos` visible y «Cargando
     * accesos…» ido). Despues de eso, si la seccion fuera a montarse, ya se
     * habria montado. Que `cargando` tampoco este cubre el parpadeo: la seccion
     * no se monta mientras los permisos no se resolvieron, asi que no hay un
     * instante en que se vea y despues se oculte.
     *
     * No se usa `page.route` para simular el rol sin permiso, por la misma razon
     * que `control-acceso.spec.js` no lo hace en ningun lado: bloquear
     * `/api/configuracion` dispara el fail-open y se verian TODOS los accesos.
     * Un rol sin permiso se prueba con un rol real logueado y nada mas.
     */
    test("el empleado no ve la sección y no dispara ninguna llamada", async ({
      api,
      playwright,
      browser,
    }) => {
      const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
      const { context, page: pagina } = await abrirComo(
        browser,
        empleado.storageState,
      );

      try {
        const pedidos = contarPedidosDeRecomendaciones(pagina);

        const accesos = new Accesos(pagina);
        const recomendaciones = new Recomendaciones(pagina);

        await accesos.irAInicio();

        await expect(recomendaciones.seccion).toHaveCount(0);
        await expect(recomendaciones.titulo).toHaveCount(0);
        await expect(recomendaciones.cargando).toHaveCount(0);

        expect(
          pedidos,
          "el empleado no tendría que disparar ninguna llamada a /api/asistente/recomendaciones",
        ).toHaveLength(0);

        // Y no se lo acusa de nada: no hubo pedido, asi que no hubo 403 que
        // mostrar. Un aviso de permiso aca seria culparlo por una pantalla que
        // nunca pidio.
        await expect(accesos.avisoPermiso).toHaveCount(0);
      } finally {
        await context.close();
      }
    });

    /**
     * El endpoint directo, salteando la pantalla.
     *
     * Es lo que esta capa aporta sobre `Backend/tests/controlAcceso.test.js`: el
     * rol sale de la cookie que emitio el sign-up —no de un pedido armado a
     * mano— y la respuesta cruza Nginx. Si el rol se perdiera en el proxy, el
     * supertest seguiria verde y esto caeria.
     *
     * Van los dos lados en el mismo test a proposito. El 403 solo no prueba que
     * el permiso funcione: una ruta mal montada, un Nginx que no proxea o un
     * middleware que rechaza a todos darian el mismo rojo para el empleado. El
     * 200 del propietario por la MISMA ruta es lo que convierte el 403 en «es
     * por el rol».
     */
    test("el empleado que pega igual al endpoint recibe 403, y el propietario 200", async ({
      api,
      playwright,
    }) => {
      const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });

      const contexto = await playwright.request.newContext({
        baseURL: BASE_URL,
        storageState: empleado.storageState,
      });

      try {
        const negada = await contexto.get("/api/asistente/recomendaciones");

        // 403 y no 401: no es una sesion vencida, es un rol sin permiso. Es la
        // distincion que HU-32 vino a corregir, y `toBe` ya excluye el 401.
        expect(
          negada.status(),
          `el empleado no tendría que poder leer las recomendaciones: ${await negada.text()}`,
        ).toBe(403);
      } finally {
        await contexto.dispose();
      }

      const permitida = await api.get("/api/asistente/recomendaciones");

      expect(
        permitida.status(),
        `el propietario sí tendría que poder: ${await permitida.text()}`,
      ).toBe(200);

      const cuerpo = await permitida.json();

      // Detector de gasto, el mismo que tiene `tests/api/asistente.spec.js`
      // para HU-26: si alguna vez este stack contesta con el modelo, la key del
      // Gateway llego al contenedor y cada corrida de los E2E esta gastando
      // credito compartido. Lo que hay que mirar entonces es
      // `docker-compose.yml`, que la vacia a proposito.
      expect(
        cuerpo.modo,
        "el stack de los E2E corre sin key del Gateway: no puede responder en modo «ia»",
      ).not.toBe("ia");

      // El contrato minimo, que la pantalla necesita siempre.
      expect(cuerpo.resumen).toBeTruthy();
      expect(cuerpo.ventana.dias).toBeGreaterThan(0);
      expect(Array.isArray(cuerpo.recomendaciones)).toBe(true);
    });
  });
});
