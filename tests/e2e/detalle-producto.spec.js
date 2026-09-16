import { expect, test } from "../soporte/fixtures.js";
import {
  crearProductoViaApi,
  crearUbicacionViaApi,
  eliminarUbicacionViaApi,
  leerStock,
  leerUbicaciones,
  stockEn,
} from "../soporte/datos.js";
import { Catalogo } from "./soporte/catalogo.js";
import {
  DetalleProducto,
  contarPosteosDeMovimiento,
} from "./soporte/detalleProducto.js";
// La ubicacion que el alta del primer producto crea sola es un hecho del
// dominio (HU-9), no de una pantalla: se reusa la constante de HU-13 en vez de
// repetir el string.
import { UBICACION_POR_DEFECTO } from "./soporte/movimientos.js";

/**
 * E2E de HU-11 — ver y controlar el stock de un producto por ubicacion.
 *
 * Corren contra el stack completo levantado con `docker compose up --build`: el
 * bundle de produccion del Frontend, servido por Nginx, hablando con el Backend
 * real y con Neon.
 *
 * Esta suite cierra el hilo que dejo abierto `productos.spec.js`: alli el
 * criterio del stock inicial se verifico contra la API porque «el stock inicial
 * no se ve en el listado (mostrarlo es HU-11)». Aca ese numero ya se ve en una
 * pantalla, asi que la verificacion pasa a ser por interfaz — y la API queda
 * como contraprueba.
 *
 * Toda asercion sobre el stock se hace dos veces: contra lo que muestra la
 * pantalla y contra `GET /api/productos/:id`. Es lo que separa «se dibujo un
 * numero» de «se guardo». Y con mas de una ubicacion se afirma siempre sobre
 * `porUbicacion` ademas del total: el total suma todas, asi que un ajuste
 * aplicado al estante equivocado daria el mismo numero y el test pasaria en
 * verde estando mal.
 *
 * Que NO se prueba aca: las validaciones de la API una por una, los 404 y 409,
 * el aislamiento multi-tenant y los roles. Eso ya lo cubre
 * Backend/tests/productos.test.js con supertest, mas rapido y con acceso a la
 * base. La API se usa como andamiaje (armar el escenario) y como contraprueba
 * de lo que la pantalla muestra.
 *
 * Tampoco se reprueba el registro de movimientos: el ajuste inline usa el mismo
 * `services/movimientos.js` que `RegistrarMovimiento`, y ese flujo —los cuatro
 * tipos, el rechazo por stock insuficiente, la atomicidad— ya esta en
 * `movimientos.spec.js` y en `tests/api/atomicidad-movimientos.spec.js`. Lo
 * propio de HU-11 es que el ajuste llegue con el producto y la ubicacion ya
 * puestos por contexto, y que la fila y el total se actualicen.
 *
 * Cada test trae su propio comercio (fixture `comercio`), asi que arranca sin
 * productos ni ubicaciones propias y se puede correr suelto, en cualquier orden
 * y en paralelo.
 */

/**
 * Los dos sentidos del ajuste. Es lo unico que la pantalla deja elegir: el tipo
 * siempre es `ajuste`, y el producto y la ubicacion los fija la fila.
 */
const CASOS = [
  {
    titulo: "una entrada suma",
    sentido: "entrada",
    stockInicial: 20,
    cantidad: 4,
    saldo: 24,
  },
  {
    titulo: "una salida resta",
    sentido: "salida",
    stockInicial: 20,
    cantidad: 6,
    saldo: 14,
  },
];

test.describe("HU-11 — Stock por ubicación", () => {
  test("muestra el stock del producto por ubicación al entrar por «Ver stock»", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "20" });

    // Se entra por el camino real y no por la URL: el link del catalogo es la
    // unica forma que tiene el usuario de llegar a esta pantalla, asi que es
    // parte del criterio y no un atajo del test.
    const catalogo = new Catalogo(page);
    await catalogo.ir();

    const detalle = new DetalleProducto(page, producto);
    await detalle.abrirDesde(catalogo);

    await expect(page).toHaveURL(new RegExp(`/productos/${producto.id}$`));

    // La ficha identifica al producto: sin esto, «se ve un 20» no dice de que
    // producto es.
    await expect(detalle.titulo).toBeVisible();
    await expect(page.getByText(producto.codigoBarras)).toBeVisible();

    // Una fila por ubicacion del comercio, con su cantidad, y el total.
    await expect(detalle.filas).toHaveCount(1);
    await expect(detalle.cantidadEn(UBICACION_POR_DEFECTO)).toHaveText("20");
    await expect(detalle.total).toHaveText("20");

    // El mismo numero segun el backend. Esta es la asercion que en
    // `productos.spec.js` tenia que hacerse solo por API.
    const stock = await leerStock(api, producto.id);
    expect(stockEn(stock, UBICACION_POR_DEFECTO)).toBe(20);
    expect(stock.total).toBe(20);

    // Y se puede volver al catalogo, que es de donde se vino.
    await detalle.volver.click();
    await expect(catalogo.titulo).toBeVisible();
  });

  for (const caso of CASOS) {
    test(`${caso.titulo}: ajustar deja la fila y el total en ${caso.saldo}`, async ({
      page,
      api,
    }) => {
      const producto = await crearProductoViaApi(api, {
        stockActual: String(caso.stockInicial),
      });

      const detalle = new DetalleProducto(page, producto);
      await detalle.ir();

      // El punto de partida se lee de la pantalla, no se asume: si mañana
      // cambia como el alta registra el stock inicial, el test lo dice aca en
      // vez de fallar mas abajo con un numero que nadie sabe de donde salio.
      await expect(detalle.cantidadEn(UBICACION_POR_DEFECTO)).toHaveText(
        String(caso.stockInicial),
      );

      await detalle.ajustar(UBICACION_POR_DEFECTO, {
        cantidad: caso.cantidad,
        sentido: caso.sentido,
      });

      // La fila y el total se actualizan solos: la pantalla recarga el producto
      // despues del ajuste, no hace falta recargar a mano.
      await expect(detalle.cantidadEn(UBICACION_POR_DEFECTO)).toHaveText(
        String(caso.saldo),
      );
      await expect(detalle.total).toHaveText(String(caso.saldo));
      await expect(detalle.errorDelBackend(UBICACION_POR_DEFECTO)).toHaveCount(0);

      // Y el backend dice el mismo numero.
      const stock = await leerStock(api, producto.id);
      expect(stockEn(stock, UBICACION_POR_DEFECTO)).toBe(caso.saldo);
      expect(stock.total).toBe(caso.saldo);

      // El formulario de la fila queda limpio para el ajuste siguiente. El
      // sentido vuelve a vacio, no al ultimo usado: un ajuste de salida
      // repetido por inercia es justo el error que esto evita.
      await expect(detalle.campoCantidad(UBICACION_POR_DEFECTO)).toHaveValue("");
      await expect(detalle.campoSentido(UBICACION_POR_DEFECTO)).toHaveValue("");
    });
  }

  test("no ajusta con datos incompletos o inválidos, y no llega a llamar al backend", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "20" });

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();

    // Se anotan los POST a `/api/movimientos` antes de empezar: «se muestra el
    // error» no prueba que el ajuste se freno en el navegador — el backend
    // podria estar rechazandolo y la pantalla mostrando ese rechazo, que es
    // otro comportamiento.
    const posteos = contarPosteosDeMovimiento(page);

    // Sin nada cargado: los dos campos son obligatorios y los dos avisan. El
    // sentido arranca vacio a proposito («Elegí una opción»), asi que no hay
    // forma de mandar un ajuste sin decir si suma o resta.
    await detalle.ajustar(UBICACION_POR_DEFECTO);

    await expect(
      detalle.errorDeCampo(UBICACION_POR_DEFECTO, "cantidad"),
    ).toHaveText("Ingresá cuántas unidades.");
    await expect(
      detalle.errorDeCampo(UBICACION_POR_DEFECTO, "sentido"),
    ).toHaveText("Indicá si el ajuste suma o resta stock.");

    // Con el sentido ya elegido queda solo el aviso de la cantidad. Lo que se
    // escribe es «dos»: el `<input type="number">` descarta lo que no es un
    // numero, asi que el campo llega vacio al submit igual que si no se hubiera
    // tocado, y el mensaje es el mismo.
    await detalle.escribirCantidad(UBICACION_POR_DEFECTO, "dos");
    await detalle.ajustar(UBICACION_POR_DEFECTO, { sentido: "entrada" });

    await expect(
      detalle.errorDeCampo(UBICACION_POR_DEFECTO, "cantidad"),
    ).toHaveText("Ingresá cuántas unidades.");
    await expect(
      detalle.errorDeCampo(UBICACION_POR_DEFECTO, "sentido"),
    ).toHaveCount(0);

    // Un 0 tampoco se envia, pero lo frena el navegador y no la aplicacion: el
    // campo declara `min="1"`, asi que la validacion nativa corta el submit
    // antes de que corra el `onSubmit` y no llega a haber mensaje propio. Lo
    // mismo pasa con una cantidad negativa o con decimales (`step` implicito de
    // 1). Por eso aca se afirma sobre lo que si es criterio —que no salga nada
    // al backend y que el saldo no se mueva— y no sobre un texto en pantalla.
    //
    // Las ramas de `validarCantidad` que atienden esos casos quedan entonces
    // como defensa en profundidad, inalcanzables desde el navegador: no las
    // puede cubrir un E2E, y hoy tampoco las cubre el unitario de la pantalla
    // (`DetalleProducto.test.jsx` prueba el caso vacio). Queda anotado en el PR
    // como observacion para el Frontend, no se fuerza un caso artificial aca.
    await detalle.ajustar(UBICACION_POR_DEFECTO, { cantidad: 0 });

    // Nada de esto salio del navegador, y el stock quedo intacto.
    expect(posteos, "un ajuste inválido llegó al backend").toHaveLength(0);
    await expect(detalle.cantidadEn(UBICACION_POR_DEFECTO)).toHaveText("20");
    await expect(detalle.total).toHaveText("20");
    expect((await leerStock(api, producto.id)).total).toBe(20);

    // Corregir el campo alcanza para seguir: el formulario no quedo trabado.
    // Ademas es lo que le da sentido al conteo de arriba — si los POST nunca
    // se contaran, aquel `toHaveLength(0)` pasaria sin probar nada.
    await detalle.ajustar(UBICACION_POR_DEFECTO, { cantidad: 3 });

    await expect(detalle.cantidadEn(UBICACION_POR_DEFECTO)).toHaveText("23");
    await expect(detalle.total).toHaveText("23");
    expect(posteos).toHaveLength(1);
    expect(stockEn(await leerStock(api, producto.id), UBICACION_POR_DEFECTO)).toBe(23);
  });

  test("con varias ubicaciones cada fila se ajusta por separado y el total las suma", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "12" });
    const deposito = await crearUbicacionViaApi(api, "Depósito");

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();

    // La ubicacion recien creada figura igual, en 0: el backend arma
    // `porUbicacion` con un LEFT JOIN desde `ubicacion`, asi que una sin
    // movimientos no falta en la lista. Sin eso no habria donde ajustarla, que
    // es la trampa que este test verifica que no existe.
    await expect(detalle.filas).toHaveCount(2);
    await expect(detalle.cantidadEn(deposito.nombre)).toHaveText("0");
    await expect(detalle.cantidadEn(UBICACION_POR_DEFECTO)).toHaveText("12");
    await expect(detalle.total).toHaveText("12");

    // Entrada en el deposito: sube el deposito y el total, y «Principal» no se
    // entera.
    await detalle.ajustar(deposito.nombre, { cantidad: 7, sentido: "entrada" });

    await expect(detalle.cantidadEn(deposito.nombre)).toHaveText("7");
    await expect(detalle.cantidadEn(UBICACION_POR_DEFECTO)).toHaveText("12");
    await expect(detalle.total).toHaveText("19");

    // Salida en «Principal»: baja solo esa. Es el reverso del caso anterior, y
    // es lo que hace verificable que cada formulario opera sobre su propia
    // ubicacion y no sobre la primera de la lista.
    await detalle.ajustar(UBICACION_POR_DEFECTO, {
      cantidad: 2,
      sentido: "salida",
    });

    await expect(detalle.cantidadEn(UBICACION_POR_DEFECTO)).toHaveText("10");
    await expect(detalle.cantidadEn(deposito.nombre)).toHaveText("7");
    await expect(detalle.total).toHaveText("17");

    // El backend coincide fila por fila. Aca es donde afirmar solo sobre el
    // total no serviria: 17 daria igual si los dos ajustes hubieran caido en la
    // misma ubicacion.
    const stock = await leerStock(api, producto.id);
    expect(stockEn(stock, UBICACION_POR_DEFECTO)).toBe(10);
    expect(stockEn(stock, deposito.nombre)).toBe(7);
    expect(stock.total).toBe(17);
  });

  test("sin ninguna ubicación configurada deriva a Configuración en vez de ofrecer un alta propia", async ({
    page,
    api,
  }) => {
    // Este estado existe pero cuesta llegar: el alta de un producto (HU-9) crea
    // la "Principal" sola, asi que un comercio con productos siempre tiene al
    // menos una. La unica forma de dejarlo sin ninguna es borrar esa, y
    // `movimiento.ubicacion_id` es `onDelete: "restrict"`: con stock inicial
    // > 0 el alta ya dejo un movimiento y el borrado vuelve 409.
    //
    // Con stock inicial 0, en cambio, el alta no registra movimiento (solo la
    // fila de `stock`, que si cae por cascada), y la ubicacion se puede borrar.
    // Es el camino que recorre un comerciante que carga productos antes de
    // organizar sus ubicaciones y despues renombra o rehace la que vino por
    // defecto: el `0` es ademas el valor con el que arranca el campo «Stock
    // inicial» del formulario de alta.
    const producto = await crearProductoViaApi(api, { stockActual: "0" });

    const [unica] = await leerUbicaciones(api);
    expect(unica.nombre).toBe(UBICACION_POR_DEFECTO);
    await eliminarUbicacionViaApi(api, unica.id);

    const detalle = new DetalleProducto(page, producto);
    await detalle.ir();

    await expect(detalle.sinUbicaciones).toBeVisible();

    // No hay filas, ni total, ni forma de ajustar: la pantalla no inventa un
    // alta de ubicaciones propia, que es de HU-8 y vive en Configuracion.
    await expect(detalle.filas).toHaveCount(0);
    await expect(detalle.total).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ajustar" })).toHaveCount(0);

    // Y el link lleva derecho a la seccion que resuelve el problema, no a
    // Configuracion a secas.
    await detalle.irAConfiguracion.click();
    await expect(page).toHaveURL(/\/configuracion\?seccion=ubicaciones$/);
  });
});
