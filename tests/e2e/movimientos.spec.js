import { expect, test } from "../soporte/fixtures.js";
import {
  crearProductoViaApi,
  crearUbicacionViaApi,
  leerStock,
  leerUbicaciones,
  stockEn,
} from "../soporte/datos.js";
import {
  Movimientos,
  UBICACION_POR_DEFECTO,
  confirmacionEsperada,
  registrarNavegaciones,
} from "./soporte/movimientos.js";

/**
 * E2E de HU-13 (SCRUM-25) — registro de movimiento de entrada/salida.
 * Subtarea de testing SCRUM-94.
 *
 * Corren contra el stack completo levantado con `docker compose up --build`: el
 * bundle de produccion del Frontend, servido por Nginx, hablando con el Backend
 * real y con Neon.
 *
 * Como se verifica el stock resultante: por `GET /api/productos/:id`, que desde
 * HU-11 devuelve `stock.porUbicacion` y `stock.total`. Es el unico lugar donde
 * se puede leer el saldo — el listado de productos no lo muestra y
 * `GET /api/movimientos` no existe hasta HU-14. Con mas de una ubicacion se
 * afirma sobre `porUbicacion` y nunca sobre `total`: el total suma todas, asi
 * que un movimiento aplicado al estante equivocado daria el mismo numero.
 *
 * Que NO se prueba aca: la validacion del body una por una, el multi-tenant,
 * los roles y la carrera de dos salidas simultaneas. Eso ya lo cubre
 * Backend/tests/movimientos.test.js con supertest y acceso a la base. Lo que si
 * queda en este repo es la atomicidad vista desde afuera del proceso, en
 * tests/api/atomicidad-movimientos.spec.js.
 *
 * Cada test trae su propio comercio (fixture `comercio`), asi que arranca sin
 * productos ni movimientos y se puede correr suelto, en cualquier orden y en
 * paralelo. Los movimientos no se limpian entre tests y no hace falta: nadie
 * mas los ve, y `movimiento` es un libro append-only — borrar filas para dejar
 * el terreno limpio contradiria justo el modelo que se esta probando. La
 * limpieza es por corrida, en `global-teardown.js`.
 */

/**
 * Un caso por tipo aceptado. El `ajuste` va dos veces porque es el unico que
 * puede ir para los dos lados, y el sentido es justamente lo suyo.
 *
 * La venta deja el saldo en 1 a proposito: `mensajeConfirmacion` tiene una rama
 * distinta para el singular, y sin este caso nunca se recorreria.
 */
const CASOS = [
  {
    titulo: "una compra suma al stock",
    tipo: "compra",
    stockInicial: 20,
    cantidad: 8,
    saldo: 28,
  },
  {
    titulo: "una venta resta del stock",
    tipo: "venta",
    stockInicial: 6,
    cantidad: 5,
    saldo: 1,
  },
  {
    titulo: "una merma resta igual que una venta",
    tipo: "merma",
    stockInicial: 20,
    cantidad: 3,
    saldo: 17,
  },
  {
    titulo: "un ajuste de entrada suma",
    tipo: "ajuste",
    sentido: "entrada",
    stockInicial: 20,
    cantidad: 4,
    saldo: 24,
  },
  {
    titulo: "un ajuste de salida resta",
    tipo: "ajuste",
    sentido: "salida",
    stockInicial: 20,
    cantidad: 6,
    saldo: 14,
  },
];

test.describe("HU-13 — Registro de movimiento", () => {
  for (const caso of CASOS) {
    test(`${caso.titulo} y deja el stock en ${caso.saldo}`, async ({
      page,
      api,
    }) => {
      const producto = await crearProductoViaApi(api, {
        stockActual: String(caso.stockInicial),
      });

      // El punto de partida se lee, no se asume: si mañana cambia como el alta
      // registra el stock inicial, el test lo dice acá en vez de fallar mas
      // abajo con un numero que nadie sabe de donde salio.
      const antes = await leerStock(api, producto.id);
      expect(stockEn(antes, UBICACION_POR_DEFECTO)).toBe(caso.stockInicial);

      const movimientos = new Movimientos(page);
      await movimientos.ir();

      await movimientos.completar({
        producto: producto.nombre,
        tipo: caso.tipo,
        sentido: caso.sentido,
        cantidad: caso.cantidad,
      });
      await movimientos.registrar();

      // La pantalla dice el numero, no solo que salio bien.
      await expect(movimientos.confirmacion).toHaveText(
        confirmacionEsperada({
          producto: producto.nombre,
          saldo: caso.saldo,
          ubicacion: UBICACION_POR_DEFECTO,
        }),
      );
      await expect(movimientos.alerta).toHaveCount(0);

      // Y la base dice el mismo numero. Las dos cosas juntas son lo que separa
      // «se mostro un cartel» de «se guardo».
      const despues = await leerStock(api, producto.id);
      expect(stockEn(despues, UBICACION_POR_DEFECTO)).toBe(caso.saldo);
      expect(despues.total).toBe(caso.saldo);

      // El formulario queda listo para el movimiento siguiente: producto y tipo
      // puestos, cantidad vacia. Es de lo que se trata el RNF1.
      await expect(movimientos.cantidad).toHaveValue("");
      await expect(movimientos.tipo).toHaveValue(caso.tipo);
      await expect(movimientos.producto).not.toHaveValue("");
    });
  }

  test("no permite una salida que dejaría el stock en negativo", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "5" });

    const movimientos = new Movimientos(page);
    await movimientos.ir();

    await movimientos.completar({
      producto: producto.nombre,
      tipo: "venta",
      cantidad: 6,
    });
    await movimientos.registrar();

    // El rechazo se muestra como aviso y no como error: no hay stock suficiente
    // es una respuesta legitima del negocio, no una falla del sistema.
    await expect(movimientos.alerta).toContainText(
      "Stock insuficiente: hay 5 unidades disponibles y se intentan descontar 6",
    );
    await expect(movimientos.alerta).toContainText("Corregí la cantidad.");
    await expect(movimientos.confirmacion).toHaveCount(0);

    // El foco vuelve a lo unico que hay que corregir.
    await expect(movimientos.cantidad).toBeFocused();

    // Y no se descontó nada: el rechazo no dejo el stock a mitad de camino.
    expect(stockEn(await leerStock(api, producto.id), UBICACION_POR_DEFECTO)).toBe(5);

    // El borde que si tiene que pasar: descontar exactamente lo disponible deja
    // el stock en 0, que no es negativo.
    await movimientos.completar({ cantidad: 5 });
    await movimientos.registrar();

    await expect(movimientos.confirmacion).toHaveText(
      confirmacionEsperada({
        producto: producto.nombre,
        saldo: 0,
        ubicacion: UBICACION_POR_DEFECTO,
      }),
    );
    expect(stockEn(await leerStock(api, producto.id), UBICACION_POR_DEFECTO)).toBe(0);

    // Con el stock ya en 0, cualquier salida se rechaza — incluido el ajuste
    // negativo, que es una salida aunque no se llame asi.
    await movimientos.completar({
      tipo: "ajuste",
      sentido: "salida",
      cantidad: 1,
    });
    await movimientos.registrar();

    await expect(movimientos.alerta).toContainText(
      "Stock insuficiente: hay 0 unidades disponibles y se intentan descontar 1",
    );
    expect(stockEn(await leerStock(api, producto.id), UBICACION_POR_DEFECTO)).toBe(0);
  });

  test("registra un movimiento en 3 pasos desde la pantalla de inicio (RNF1)", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "10" });

    // Se anotan las pantallas por las que se pasa antes de arrancar: contar los
    // pasos a mano no prueba nada si nadie verifica que no hubo pantallas
    // intermedias.
    const pantallas = registrarNavegaciones(page);
    const pasos = [];

    await page.goto("/");
    await expect(page.getByRole("heading", { name: /^Hola,/ })).toBeVisible();

    // Paso 1. El link es la primera accion de la pantalla de inicio.
    pasos.push("clic en «Registrar movimiento» desde el inicio");
    await page.getByRole("link", { name: "Registrar movimiento" }).click();

    const movimientos = new Movimientos(page);
    await expect(movimientos.formulario).toBeVisible();

    // Todo lo obligatorio esta en esta pantalla y a la vez: no hay ni un clic
    // de por medio para llegar a un campo.
    await expect(movimientos.producto).toBeVisible();
    await expect(movimientos.tipo).toBeVisible();
    await expect(movimientos.cantidad).toBeVisible();

    // Y no es un wizard: dentro del formulario el unico boton es el de
    // confirmar. Un «Siguiente» sumaria un paso y este conteo caeria.
    await expect(movimientos.formulario.getByRole("button")).toHaveCount(1);

    // Paso 2. Completar, sin salir de la pantalla.
    pasos.push("completar el formulario");
    await movimientos.completar({
      producto: producto.nombre,
      tipo: "venta",
      cantidad: 4,
    });

    // Paso 3. Confirmar.
    pasos.push("clic en «Registrar movimiento»");
    await movimientos.registrar();

    await expect(movimientos.confirmacion).toHaveText(
      confirmacionEsperada({
        producto: producto.nombre,
        saldo: 6,
        ubicacion: UBICACION_POR_DEFECTO,
      }),
    );

    expect(pasos).toHaveLength(3);

    // Lo que le da sentido al conteo: del inicio a la confirmacion se paso por
    // dos pantallas y ninguna mas. Una pantalla intermedia rompe este test.
    expect(pantallas).toEqual(["/", "/movimientos/nuevo"]);
  });

  test.describe("Ubicación", () => {
    test("con una sola ubicación el campo no se pide", async ({ page, api }) => {
      const producto = await crearProductoViaApi(api, { stockActual: "12" });

      // Precondicion explicita: el alta del producto creo «Principal» y no hay
      // ninguna otra. Sin esto el test podria pasar por el motivo equivocado.
      const ubicaciones = await leerUbicaciones(api);
      expect(ubicaciones.map((una) => una.nombre)).toEqual([
        UBICACION_POR_DEFECTO,
      ]);

      const movimientos = new Movimientos(page);
      await movimientos.ir();

      // No esta oculto ni deshabilitado: no se renderiza.
      await expect(movimientos.ubicacion).toHaveCount(0);
      await expect(movimientos.errorDeCampo("ubicacionId")).toHaveCount(0);

      await movimientos.completar({
        producto: producto.nombre,
        tipo: "compra",
        cantidad: 3,
      });
      await movimientos.registrar();

      // Se registra igual, y la confirmacion nombra la ubicacion que resolvio
      // el backend: es el unico lugar donde el usuario se entera de cual uso.
      await expect(movimientos.confirmacion).toHaveText(
        confirmacionEsperada({
          producto: producto.nombre,
          saldo: 15,
          ubicacion: UBICACION_POR_DEFECTO,
        }),
      );

      expect(stockEn(await leerStock(api, producto.id), UBICACION_POR_DEFECTO)).toBe(15);
    });

    test("con más de una es obligatoria y el stock cae en la elegida", async ({
      page,
      api,
    }) => {
      // El reverso del caso anterior, que es lo que lo hace verificable: si el
      // campo nunca apareciera, aquel test pasaria igual sin probar nada.
      const producto = await crearProductoViaApi(api, { stockActual: "12" });
      const deposito = await crearUbicacionViaApi(api, "Depósito");

      const movimientos = new Movimientos(page);
      await movimientos.ir();
      await expect(movimientos.ubicacion).toBeVisible();

      // Sin elegirla no se envia nada: el error queda anclado al campo.
      await movimientos.completar({
        producto: producto.nombre,
        tipo: "compra",
        cantidad: 7,
      });
      await movimientos.registrar();

      await expect(movimientos.errorDeCampo("ubicacionId")).toHaveText(
        "Elegí de qué ubicación sale o a cuál entra.",
      );
      await expect(movimientos.confirmacion).toHaveCount(0);
      expect((await leerStock(api, producto.id)).total).toBe(12);

      await movimientos.completar({ ubicacion: deposito.nombre });
      await movimientos.registrar();

      await expect(movimientos.confirmacion).toHaveText(
        confirmacionEsperada({
          producto: producto.nombre,
          saldo: 7,
          ubicacion: deposito.nombre,
        }),
      );

      // Acá es donde HU-11 hace falta de verdad: `total` daria 19 igual si el
      // movimiento hubiera caido en «Principal», asi que la asercion que
      // importa es por ubicacion. Y la otra tiene que haber quedado intacta.
      const despues = await leerStock(api, producto.id);
      expect(stockEn(despues, deposito.nombre)).toBe(7);
      expect(stockEn(despues, UBICACION_POR_DEFECTO)).toBe(12);
      expect(despues.total).toBe(19);
    });
  });
});
