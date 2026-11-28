import { expect } from "@playwright/test";
import { crearProductoViaApi, crearProveedorViaApi } from "./datos.js";
import { comprarViaApi, venderViaApi } from "./alertas.js";
import { crearCompraViaApi } from "./comprasProveedor.js";

/**
 * Andamiaje de HU-22 — KPIs principales del dashboard (`GET /api/kpis`).
 *
 * Todo se arma por los caminos reales (altas de HU-9, movimientos de HU-13,
 * proveedores de HU-19): no se inserta ninguna fila a mano. Asi el escenario
 * atraviesa la misma transaccion que mantiene `stock` y la misma huella con la
 * que el backend invalida su cache de KPIs.
 */

/** `GET /api/kpis` crudo, sin afirmar nada. */
export function pedirKpis(api, query = "") {
  return api.get(`/api/kpis${query}`);
}

/** Los KPIs como andamiaje: exige el 200 y devuelve el cuerpo. */
export async function leerKpisViaApi(api, query = "") {
  const respuesta = await pedirKpis(api, query);

  expect(
    respuesta.status(),
    `No se pudieron leer los KPIs: ${await respuesta.text()}`,
  ).toBe(200);

  return respuesta.json();
}

/**
 * Un comercio chico con un libro conocido, donde cada numero del dashboard se
 * calcula a mano. Los numeros no son redondos a proposito: un total que sumara
 * de mas o de menos no puede dar igual por casualidad.
 *
 *   producto  umbral  movimientos                              saldo
 *   Yerba     5       alta +30, compra a X +10, ventas -5 -2   33  normal
 *   Fideos    10      alta +4, compra sin proveedor +3         7   en o bajo el minimo
 *   Arroz     0       alta +2, venta -2                        0   sin stock
 *
 *   stock:    3 productos, 40 unidades, 1 sin stock, 1 bajo, 1 normal
 *   rotacion: 3 ventas, 9 unidades; Yerba 7, Arroz 2
 *   compras:  2 compras, 13 unidades; X 1/10, sin proveedor 1/3
 *
 * Todos los productos se crean ahora, asi que ninguno cuenta como "sin ventas":
 * ese indicador solo mira los que ya existian al empezar la ventana.
 */
export async function escenarioDeKpis(api) {
  const sufijo = Date.now() % 100000;

  const proveedor = await crearProveedorViaApi(api);

  const yerba = await crearProductoViaApi(api, {
    nombre: `Yerba HU22 ${sufijo}`,
    umbralMinimo: "5",
    stockActual: "30",
  });
  const fideos = await crearProductoViaApi(api, {
    nombre: `Fideos HU22 ${sufijo}`,
    umbralMinimo: "10",
    stockActual: "4",
  });
  const arroz = await crearProductoViaApi(api, {
    nombre: `Arroz HU22 ${sufijo}`,
    umbralMinimo: "0",
    stockActual: "2",
  });

  await crearCompraViaApi(api, {
    productoId: yerba.id,
    proveedorId: proveedor.id,
    cantidad: 10,
  });
  await comprarViaApi(api, { productoId: fideos.id, cantidad: 3 });

  await venderViaApi(api, { productoId: yerba.id, cantidad: 5 });
  await venderViaApi(api, { productoId: yerba.id, cantidad: 2 });
  await venderViaApi(api, { productoId: arroz.id, cantidad: 2 });

  return {
    proveedor,
    yerba,
    fideos,
    arroz,
    esperado: {
      stock: {
        productos: 3,
        unidades: 40,
        sinStock: 1,
        bajoUmbral: 1,
        normal: 1,
        productosSinVentas: 0,
      },
      rotacion: { ventas: 3, unidadesVendidas: 9 },
      compras: { compras: 2, unidades: 13, proveedoresConCompras: 1 },
    },
  };
}

/* ===========================================================================
 * HU-23 — Filtrado de KPIs por periodo (SCRUM-35 / SCRUM-145)
 * ========================================================================= */

/**
 * La zona en la que se cortan los dias, en los TRES lados del sistema.
 *
 * No es una eleccion de este archivo: el Backend la tiene fija en
 * `ZONA_HORARIA` (src/services/kpis.service.js) y el Frontend en `ZONA`
 * (src/services/periodos.js), los dos con `timeZone` explicito. Se repite aca
 * para poder calcular lo esperado SIN preguntarle a ninguno de los dos: si el
 * test leyera el dia de la pagina, un Frontend que lo calcula mal pasaria igual.
 *
 * Argentina no tiene horario de verano desde 2009, asi que el offset es fijo.
 */
export const ZONA = "America/Argentina/Buenos_Aires";
export const OFFSET = "-03:00";

/** Los dos topes del backend, que se comportan DISTINTO (ver abajo). */
export const TOPE_MOVIL_DIAS = 90;
export const TOPE_RANGO_DIAS = 366;

/** Hasta cuantos dias el grafico dibuja una barra por dia / por semana. */
export const TOPE_SERIE_DIARIA = 62;
export const TOPE_SERIE_SEMANAL = 180;

const DIA_MS = 86_400_000;

const FORMATO_ISO_EN_ZONA = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * "AAAA-MM-DD" de hoy en Argentina, con un corrimiento de dias opcional.
 *
 * Es el mismo helper que `diaEnArgentina` de tests/soporte/reportes.js, y por el
 * mismo motivo, que es la trampa central de esta HU del lado de los tests: el
 * proceso de Node corre en la zona del SISTEMA. `timezoneId` de
 * playwright.config.js fija la del navegador y no la toca, y los runners de
 * GitHub Actions corren en UTC. Un `new Date()` pelado a las 21 h de Argentina
 * da ya el dia siguiente en el runner, y el off-by-one solo aparece en CI.
 *
 * No se importa de reportes.js para no atar el soporte de esta HU al de HU-25;
 * son cuatro lineas y cada uno documenta su propio motivo.
 */
export function diaEnArgentina(corrimientoEnDias = 0) {
  const [anio, mes, dia] = FORMATO_ISO_EN_ZONA.format(new Date())
    .split("-")
    .map(Number);

  return new Date(Date.UTC(anio, mes - 1, dia) + corrimientoEnDias * DIA_MS)
    .toISOString()
    .slice(0, 10);
}

/** Suma dias a un "AAAA-MM-DD" sin que ninguna zona se meta. */
export function sumarDias(dia, cantidad) {
  const [anio, mes, numero] = dia.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, numero) + cantidad * DIA_MS)
    .toISOString()
    .slice(0, 10);
}

/** Dias calendario entre dos dias, LOS DOS INCLUIDOS. Del 1 al 1 es 1, no 0. */
export function diasEntre(desde, hasta) {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / DIA_MS) + 1;
}

/**
 * Los dos instantes que viajan al backend para un rango de dias calendario.
 *
 * LOS DOS EXTREMOS SON INCLUSIVE: del 1 a las 00:00:00.000 al 31 a las
 * 23:59:59.000, no al 1 del mes siguiente a las 00:00. Mandar el dia siguiente
 * a las 00:00 esperando que quede afuera lo mete adentro.
 */
export function rangoDePeriodo(diaDesde, diaHasta) {
  return {
    desde: `${diaDesde}T00:00:00.000${OFFSET}`,
    hasta: `${diaHasta}T23:59:59.000${OFFSET}`,
  };
}

/** El lunes de la semana que CONTIENE un dia. El domingo cierra, no abre. */
export function lunesDe(dia) {
  const [anio, mes, numero] = dia.split("-").map(Number);
  const diaDeSemana = new Date(Date.UTC(anio, mes - 1, numero)).getUTCDay();
  // 0 = domingo, y el domingo pertenece a la semana que TERMINA: su lunes esta
  // seis dias ATRAS, no al dia siguiente. Es el caso que mas se rompe.
  return sumarDias(dia, diaDeSemana === 0 ? -6 : 1 - diaDeSemana);
}

/** El primer y el ultimo dia del mes que CONTIENE un dia. */
export function mesDe(dia) {
  const [anio, mes] = dia.split("-").map(Number);
  // Dia 0 del mes siguiente = ultimo del actual, sin tabla de dias por mes.
  const ultimo = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  return { primero: `${dia.slice(0, 7)}-01`, ultimo };
}

/**
 * Los parametros que TIENE que emitir cada preset del selector, resueltos
 * contra un dia de Argentina.
 *
 * Se calcula aca, en Node y con la zona explicita, y no se le pregunta a la
 * pagina: es la unica forma de que el test caiga si el Frontend resuelve la
 * semana o el mes de otra manera. Replica la regla de `presets` y `PERIODOS` de
 * Frontend/src/services/periodos.js.
 *
 * Los rodantes mandan `dias` y no dependen de ninguna fecha. "30 dias" NO MANDA
 * NADA: es el default del backend y tambien el periodo inicial de la pantalla
 * (ver la trampa del waitForResponse en tests/e2e/soporte/kpis.js).
 */
export function paramsEsperados(id, hoy = diaEnArgentina()) {
  switch (id) {
    case "hoy":
      return { dias: "1" };
    case "7":
      return { dias: "7" };
    case "30":
      return {};
    case "90":
      return { dias: "90" };
    case "semana": {
      const lunes = lunesDe(hoy);
      return rangoDePeriodo(lunes, sumarDias(lunes, 6));
    }
    case "mes": {
      const { primero, ultimo } = mesDe(hoy);
      return rangoDePeriodo(primero, ultimo);
    }
    default:
      throw new Error(`Preset desconocido: "${id}"`);
  }
}

/**
 * Un periodo cerrado del pasado, FIJO y literal.
 *
 * Es la unica fecha fija de este soporte, y es donde la regla del repo si vale:
 * el periodo que tiene que dejar los datos AFUERA. Enero de 2026 es anterior al
 * primer commit del proyecto, asi que ningun movimiento puede caer adentro. Con
 * un rango relativo ("hace un año"), el dia que alguien corriera la suite con el
 * reloj movido empezaria a incluir ventas y el test del estado vacio pasaria a
 * probar otra cosa sin que nadie se enterara. Mismo criterio que
 * `PERIODO_SIN_COMPRAS` de HU-21.
 */
export const PERIODO_SIN_DATOS = { desde: "2026-01-01", hasta: "2026-01-31" };

/**
 * Rangos para los limites del periodo (criterio «limites» de SCRUM-145).
 *
 * POR QUE NO HAY FIXTURES CON FECHA. `movimiento.fecha` es `defaultNow()` y ni
 * el service ni el POST aceptan una fecha, asi que todo movimiento creado por el
 * flujo real es de HOY (lo documenta tests/soporte/comprasProveedor.js). No se
 * puede armar un libro repartido en varios dias, y por lo tanto tampoco se puede
 * poner un movimiento en 23:59:59.x.
 *
 * Entonces cada extremo se aisla con un rango que lo apoya en hoy:
 *
 *   `terminaHoy`  [hoy-5, hoy]    incluye  -> `hasta` es INCLUSIVE
 *   `empiezaHoy`  [hoy, hoy+5]    incluye  -> `desde` es INCLUSIVE
 *   `soloHoy`     [hoy, hoy]      incluye  -> los dos a la vez, periodo.dias 1
 *   `terminaAyer` [hoy-5, hoy-1]  excluye  -> el borde se nota
 */
export function rangosDeBorde(hoy = diaEnArgentina()) {
  return {
    hoy,
    terminaHoy: { desde: sumarDias(hoy, -5), hasta: hoy },
    empiezaHoy: { desde: hoy, hasta: sumarDias(hoy, 5) },
    soloHoy: { desde: hoy, hasta: hoy },
    terminaAyer: { desde: sumarDias(hoy, -5), hasta: sumarDias(hoy, -1) },
  };
}

/** `?desde=…&hasta=…` ya armado, con los dos instantes de un rango de dias. */
export function queryDeRango({ desde, hasta }) {
  const instantes = rangoDePeriodo(desde, hasta);
  return `?${new URLSearchParams(instantes)}`;
}
