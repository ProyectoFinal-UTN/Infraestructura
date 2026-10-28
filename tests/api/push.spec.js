import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "./soporte/base.js";
import { BASE_URL } from "../soporte/entorno.js";
import {
  crearProductoViaApi,
  enviarMovimiento,
  leerStock,
  registrarMovimientoViaApi,
  stockEn,
} from "../soporte/datos.js";
import { sumarMiembro } from "../soporte/equipo.js";

/**
 * HU-18 — Notificaciones push de reposicion: el contrato de
 * `/api/push/suscripciones` y el aviso que dispara una venta, verificados a
 * traves del stack real.
 *
 * Va contra la API porque nada de esto se ve por pantalla: la suscripcion es
 * una fila en `suscripcion_push` (que se lee directo de la base con el fixture
 * `base`) y el aviso corre en segundo plano despues de responder. Lo que la
 * pantalla si muestra —el interruptor de Configuracion— depende de un service
 * worker y de un permiso del navegador que Playwright no puede conceder con un
 * servicio de push real detras.
 *
 * Tiene que pasar CON y SIN claves VAPID en ../Backend/.env, porque el compose
 * no las pisa (ver docker-compose.yml) y cada integrante puede tener o no el
 * par local. Las suscripciones funcionan igual en los dos casos; lo unico que
 * cambia es si el backend intenta mandar el aviso. Los tests que dependen de
 * eso lo dejan anotado en el reporte (`push habilitado`).
 *
 * Ningun test manda un push de verdad: los endpoints son de `.invalid`, un
 * dominio reservado que nunca resuelve (RFC 2606). Con claves, el envio falla
 * en el DNS sin salir de la PC; sin claves, ni se intenta.
 *
 * Backend/tests/ ya cubre la validacion y el envio en proceso, con el envio
 * mockeado. Lo que agrega este archivo es que el contrato sobrevive al stack:
 * Nginx, el contenedor, Neon, y un envio que falla de verdad.
 */

const RUTA = "/api/push/suscripciones";

/** Un endpoint con forma de servicio de push, unico por llamada. */
function endpointFalso() {
  return `https://push-falso.invalid/e2e/${randomUUID()}`;
}

/**
 * Lo que manda el Frontend: `PushSubscription.toJSON()` tal cual.
 *
 * Las claves se generan en cada llamada con la misma curva que usa el
 * navegador (P-256), en vez de copiar unas de ejemplo: el backend solo valida
 * que sean base64url, pero con claves de verdad el envio del ultimo test llega
 * hasta la red en vez de cortarse antes, al cifrar.
 */
function suscripcionFalsa(endpoint = endpointFalso()) {
  const navegador = createECDH("prime256v1");
  navegador.generateKeys();

  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: navegador.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

function suscribir(api, suscripcion) {
  return api.post(RUTA, { data: suscripcion });
}

function desuscribir(api, endpoint) {
  return api.delete(RUTA, { data: { endpoint } });
}

/** Suscribe como andamiaje: exige el 201. */
async function suscribirViaApi(api, suscripcion) {
  const respuesta = await suscribir(api, suscripcion);

  expect(
    respuesta.status(),
    `No se pudo guardar la suscripcion: ${await respuesta.text()}`,
  ).toBe(201);
}

/**
 * Si el backend del stack tiene claves VAPID, y lo deja en el reporte.
 *
 * No cambia lo que se afirma —los tests valen igual en los dos modos—, pero sin
 * la anotacion un verde no diria si el envio en segundo plano se intento.
 */
async function anotarModoPush(api) {
  const respuesta = await api.get("/api/push/clave-publica");
  const habilitado = respuesta.status() === 200;

  test.info().annotations.push({
    type: "push habilitado",
    description: habilitado
      ? "sí: hay claves VAPID y el backend intenta mandar el aviso"
      : "no: sin claves VAPID, el backend no intenta ningún envío",
  });

  return { respuesta, habilitado };
}

test.describe("HU-18 — Notificaciones push de reposición (API)", () => {
  test("sin sesión, las tres rutas responden 401 y no se guarda nada", async ({
    playwright,
    base,
  }) => {
    // `storageState` vacio y no omitido: `request.newContext()` hereda el del
    // test, que es la sesion del comercio (ver `sumarMiembro` en equipo.js).
    const anonimo = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });

    try {
      const suscripcion = suscripcionFalsa();

      const respuestas = {
        "GET /api/push/clave-publica": await anonimo.get(
          "/api/push/clave-publica",
        ),
        [`POST ${RUTA}`]: await suscribir(anonimo, suscripcion),
        [`DELETE ${RUTA}`]: await desuscribir(anonimo, suscripcion.endpoint),
      };

      for (const [ruta, respuesta] of Object.entries(respuestas)) {
        expect(respuesta.status(), ruta).toBe(401);
        expect((await respuesta.json()).error, ruta).toBe(
          "No hay sesion activa",
        );
      }

      expect(await base.suscripcionesPush(suscripcion.endpoint)).toEqual([]);
    } finally {
      await anonimo.dispose();
    }
  });

  test("la clave pública responde según haya o no claves VAPID", async ({
    api,
  }) => {
    const { respuesta, habilitado } = await anotarModoPush(api);

    if (habilitado) {
      // Es lo que el Frontend pasa como `applicationServerKey`: una clave
      // publica P-256 sin comprimir, 65 bytes que empiezan en 0x04. Una clave
      // mal copiada en el .env haria fallar la suscripcion en el navegador.
      const { clavePublica } = await respuesta.json();
      const bytes = Buffer.from(clavePublica, "base64url");

      expect(clavePublica).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(bytes).toHaveLength(65);
      expect(bytes[0]).toBe(0x04);
    } else {
      // Sin claves el backend arranca igual y avisa con 503, que es lo que el
      // Frontend usa para deshabilitar el interruptor.
      expect(respuesta.status()).toBe(503);
      expect((await respuesta.json()).error).toBe(
        "Las notificaciones push no están disponibles en este servidor",
      );
    }
  });

  test("suscribirse responde 201 y reenviar la misma suscripción no duplica la fila", async ({
    api,
    base,
    comercio,
  }) => {
    const suscripcion = suscripcionFalsa();

    const primera = await suscribir(api, suscripcion);
    expect(primera.status(), await primera.text()).toBe(201);
    expect(await primera.json()).toEqual({
      endpoint: suscripcion.endpoint,
      expiraEn: null,
    });

    const filas = await base.suscripcionesPush(suscripcion.endpoint);
    expect(filas).toEqual([
      {
        comercio_id: expect.any(String),
        email: comercio.email,
        p256dh: suscripcion.keys.p256dh,
        auth: suscripcion.keys.auth,
      },
    ]);

    // El Frontend vuelve a mandar la suscripcion cada vez que se activa el
    // interruptor o se recarga la app: tiene que ser idempotente.
    const segunda = await suscribir(api, suscripcion);
    expect(segunda.status(), await segunda.text()).toBe(201);
    expect(await base.suscripcionesPush(suscripcion.endpoint)).toEqual(filas);
  });

  test("una suscripción inválida responde 400 y no se guarda", async ({
    api,
    base,
  }) => {
    const valida = suscripcionFalsa();
    const endpointHttp = valida.endpoint.replace("https:", "http:");
    const sinHttps = "El endpoint de la suscripción no es una URL https válida";

    const invalidas = [
      {
        titulo: "endpoint http",
        cuerpo: { ...valida, endpoint: endpointHttp },
        error: sinHttps,
      },
      {
        titulo: "endpoint que no es una URL",
        cuerpo: { ...valida, endpoint: "no-es-una-url" },
        error: sinHttps,
      },
      {
        titulo: "sin endpoint",
        cuerpo: { keys: valida.keys },
        error: "Falta el endpoint de la suscripción",
      },
      {
        titulo: "sin keys",
        cuerpo: { endpoint: valida.endpoint },
        error: 'Falta la clave "p256dh" de la suscripción o no es válida',
      },
      {
        titulo: "sin p256dh",
        cuerpo: { endpoint: valida.endpoint, keys: { auth: valida.keys.auth } },
        error: 'Falta la clave "p256dh" de la suscripción o no es válida',
      },
      {
        titulo: "sin auth",
        cuerpo: {
          endpoint: valida.endpoint,
          keys: { p256dh: valida.keys.p256dh },
        },
        error: 'Falta la clave "auth" de la suscripción o no es válida',
      },
    ];

    for (const caso of invalidas) {
      const respuesta = await suscribir(api, caso.cuerpo);

      expect(respuesta.status(), caso.titulo).toBe(400);
      expect((await respuesta.json()).error, caso.titulo).toBe(caso.error);
    }

    expect(await base.suscripcionesPush(valida.endpoint)).toEqual([]);
    expect(await base.suscripcionesPush(endpointHttp)).toEqual([]);

    // El reverso: la misma suscripcion, completa, entra. Si algun 400 fuera
    // por otra cosa, aca tambien fallaria.
    await suscribirViaApi(api, valida);
    expect(await base.suscripcionesPush(valida.endpoint)).toHaveLength(1);
  });

  test("darse de baja responde 204, también si la suscripción no existía", async ({
    api,
    base,
  }) => {
    const suscripcion = suscripcionFalsa();
    await suscribirViaApi(api, suscripcion);

    const baja = await desuscribir(api, suscripcion.endpoint);
    expect(baja.status(), await baja.text()).toBe(204);
    expect(await base.suscripcionesPush(suscripcion.endpoint)).toEqual([]);

    // Silenciar dos veces (dos pestañas, o el logout despues de apagar el
    // interruptor) no es un error.
    expect((await desuscribir(api, suscripcion.endpoint)).status()).toBe(204);
    expect((await desuscribir(api, endpointFalso())).status()).toBe(204);

    // Lo que si es un error es un endpoint que no es https: ahi no hay nada
    // que buscar.
    const mala = await desuscribir(
      api,
      suscripcion.endpoint.replace("https:", "http:"),
    );
    expect(mala.status()).toBe(400);
  });

  test("si otra persona del comercio se suscribe desde el mismo navegador, la suscripción pasa a ser suya", async ({
    playwright,
    api,
    base,
    comercio,
  }) => {
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const apiEmpleado = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: empleado.storageState,
    });

    try {
      const delPropietario = suscripcionFalsa();
      const { endpoint } = delPropietario;

      await suscribirViaApi(api, delPropietario);
      const [antes] = await base.suscripcionesPush(endpoint);
      expect(antes.email).toBe(comercio.email);

      // Mismo endpoint —el mismo celular— con claves nuevas, que es lo peor
      // que puede pasar: si el upsert reasignara el dueno pero dejara las
      // claves viejas, el aviso le llegaria cifrado con claves que el
      // navegador ya no tiene.
      const delEmpleado = suscripcionFalsa(endpoint);
      await suscribirViaApi(apiEmpleado, delEmpleado);

      expect(await base.suscripcionesPush(endpoint)).toEqual([
        {
          comercio_id: antes.comercio_id,
          email: empleado.email,
          p256dh: delEmpleado.keys.p256dh,
          auth: delEmpleado.keys.auth,
        },
      ]);

      // El propietario ya no es el dueno: su baja responde 204 igual (no
      // revela que el endpoint existe) pero no borra la del empleado.
      expect((await desuscribir(api, endpoint)).status()).toBe(204);
      expect(await base.suscripcionesPush(endpoint)).toHaveLength(1);

      expect((await desuscribir(apiEmpleado, endpoint)).status()).toBe(204);
      expect(await base.suscripcionesPush(endpoint)).toEqual([]);
    } finally {
      await apiEmpleado.dispose();
    }
  });

  test("una venta que cruza el umbral con una suscripción a un endpoint falso se registra igual", async ({
    api,
    base,
  }) => {
    await anotarModoPush(api);

    // Umbral 5 y 10 en stock: la venta de 6 deja 4, o sea cruza el umbral
    // hacia abajo, que es lo unico que dispara el aviso.
    const producto = await crearProductoViaApi(api, {
      umbralMinimo: "5",
      stockActual: "0",
    });
    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      tipo: "compra",
      cantidad: 10,
    });

    const suscripcion = suscripcionFalsa();
    await suscribirViaApi(api, suscripcion);

    const venta = await enviarMovimiento(api, {
      productoId: producto.id,
      tipo: "venta",
      cantidad: 6,
    });

    expect(venta.status(), await venta.text()).toBe(201);
    expect(stockEn(await leerStock(api, producto.id), "Principal")).toBe(4);
    expect(await base.movimientosDe(producto.id)).toHaveLength(2);

    // El envio corre en segundo plano y no hay endpoint que diga cuando
    // termino, asi que lo que se puede afirmar es que el backend sigue en pie
    // despues: un rechazo sin atrapar tiraria el proceso y lo que sigue
    // fallaria. La falla de DNS de `.invalid` es casi inmediata, mucho mas
    // corta que estos viajes a Neon.
    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      tipo: "venta",
      cantidad: 1,
    });
    expect(stockEn(await leerStock(api, producto.id), "Principal")).toBe(3);
    expect((await api.get("/health")).status()).toBe(200);

    // Una falla de red no es un 404/410 del servicio de push: no significa que
    // la suscripcion vencio, asi que no se borra.
    expect(await base.suscripcionesPush(suscripcion.endpoint)).toHaveLength(1);
  });
});
