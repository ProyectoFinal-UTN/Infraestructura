import { expect } from "@playwright/test";
import { PDFParse } from "pdf-parse";
import {
  crearProductoViaApi,
  crearProveedorViaApi,
  registrarMovimientoViaApi,
} from "./datos.js";
import { crearCompraViaApi } from "./comprasProveedor.js";

/**
 * Andamiaje de los reportes de movimientos en PDF (HU-25), compartido por las
 * dos suites.
 *
 * Igual que en HU-21, los movimientos se crean por el FLUJO REAL de HU-13 y no
 * insertando filas: un reporte que filtra bien una fila imposible de producir
 * por la aplicacion no prueba nada. Y por lo mismo las fechas no se pueden fijar
 * (`movimiento.fecha` es `defaultNow()` y el POST no acepta una): lo fijo es el
 * rango que las deja AFUERA, y el que las incluye se calcula alrededor de hoy.
 *
 * Los nombres de productos y proveedores son ASCII a proposito. El nombre del
 * archivo lleva un "slug" del producto o del proveedor (sin tildes, en
 * minuscula, con guiones), y con nombres sin tildes el nombre esperado se puede
 * escribir a mano en el test y leerse de un vistazo. Las tildes y la ñ dentro
 * del PDF ya las cubre `Backend/tests/reportes.test.js`; aca van solo en el
 * nombre del comercio, que es lo que el criterio de aceptacion pide ver.
 */

/** El endpoint, una sola vez: lo usan los specs y el conteo de pedidos. */
export const RUTA_REPORTE = "/api/reportes/movimientos";

/**
 * Un rango cerrado del pasado, anterior a cualquier corrida posible: enero de
 * 2026, antes del primer commit del proyecto. Mismo criterio que
 * `PERIODO_SIN_COMPRAS` de HU-21. En dos formas: dias para la pantalla e
 * instantes con zona para la API.
 */
export const RANGO_SIN_MOVIMIENTOS = {
  dias: { desde: "2026-01-01", hasta: "2026-01-31" },
  api: {
    desde: "2026-01-01T00:00:00.000-03:00",
    hasta: "2026-01-31T23:59:59.999-03:00",
  },
  /** Como lo escribe el PDF en "Rango aplicado". */
  enPdf: "01/01/2026 00:00 al 31/01/2026 23:59",
};

/** El texto del PDF cuando el rango no tiene movimientos. */
export const MENSAJE_SIN_MOVIMIENTOS =
  "No se registraron movimientos en el rango seleccionado.";

/**
 * "AAAA-MM-DD" de hoy en Argentina, con un corrimiento de dias opcional.
 *
 * Se calcula con la zona explicita y no con `new Date()` pelado: el proceso de
 * Node corre en la zona del sistema (`timezoneId` de playwright.config.js solo
 * fija la del navegador), y el backend arma el nombre del archivo en la hora de
 * Argentina. Argentina no tiene horario de verano, asi que -03:00 es fijo.
 */
export function diaEnArgentina(corrimientoEnDias = 0) {
  const hoy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const [anio, mes, dia] = hoy.split("-").map(Number);
  const corrido = new Date(Date.UTC(anio, mes - 1, dia + corrimientoEnDias));

  return corrido.toISOString().slice(0, 10);
}

/**
 * Un rango para la API que seguro incluye lo que se acaba de registrar: de
 * ayer a manana, en hora de Argentina. Un dia de margen para cada lado porque
 * la suite puede correr cerca de la medianoche, y un movimiento de las 23:59:59
 * consultado a las 00:00:01 quedaria afuera de un rango de "hoy".
 */
export function rangoAlrededorDeHoy() {
  const desde = diaEnArgentina(-1);
  const hasta = diaEnArgentina(1);

  return {
    dias: { desde, hasta },
    api: {
      desde: `${desde}T00:00:00.000-03:00`,
      hasta: `${hasta}T23:59:59.999-03:00`,
    },
  };
}

/** "AAAA-MM-DD" → "DD/MM/AAAA", el formato de las fechas dentro del PDF. */
export function fechaComoEnPdf(dia) {
  const [anio, mes, numero] = dia.split("-");
  return `${numero}/${mes}/${anio}`;
}

/**
 * El "Rango aplicado" que tiene que escribir el PDF para un par de dias: del
 * primer minuto del primero al ultimo del segundo. Es como lo arma
 * `formatearFechaHora` del backend, con precision de minutos.
 */
export function rangoComoEnPdf({ desde, hasta }) {
  return `${fechaComoEnPdf(desde)} 00:00 al ${fechaComoEnPdf(hasta)} 23:59`;
}

/**
 * El nombre de archivo que el backend sugiere en `Content-Disposition`:
 * `reporte-movimientos-<tipo>[-<slug>]-<desde>_<hasta>.pdf`.
 *
 * El slug se escribe aca con una regla simple (minusculas y guiones) que solo
 * es equivalente a la del backend para nombres ASCII, que son los unicos que
 * usa esta suite (ver arriba).
 */
export function nombreDeArchivoEsperado({ tipo, sujeto, desde, hasta }) {
  const slug = sujeto
    ? `-${sujeto.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`
    : "";

  return `reporte-movimientos-${tipo}${slug}-${desde}_${hasta}.pdf`;
}

/**
 * Le pone nombre al comercio del test (HU-6).
 *
 * Sin esto todos los comercios de la suite se llaman "Mi comercio", el
 * placeholder del registro, y "el PDF trae el nombre del comercio" pasaria
 * aunque el reporte saliera con el nombre de otro. Con un nombre propio por
 * test, el PDF solo puede traerlo si lo leyo del comercio de la sesion.
 *
 * Lleva tilde a proposito: el PDF usa Helvetica estandar (WinAnsi), y una
 * tilde que se perdiera en el camino haria fallar el `toContain`.
 */
export async function ponerNombreAlComercio(api, nombre) {
  const respuesta = await api.put("/api/comercio", {
    data: { nombre, rubro: "Almacén" },
  });

  expect(
    respuesta.status(),
    `No se pudo nombrar el comercio: ${await respuesta.text()}`,
  ).toBe(200);
}

/**
 * El escenario de casi todos los tests: dos productos, dos proveedores y tres
 * movimientos que se reparten de forma que cada filtro deje afuera algo.
 *
 * - Yerba: compra de 7 a la Yerbatera y venta de 2.
 * - Azucar: compra de 3 al Ingenio.
 *
 * Por periodo entran los 3. Por producto (Yerba) entran 2 y el Azucar no puede
 * aparecer. Por proveedor (Yerbatera) entra 1 —la compra de Yerba— y ni el
 * Azucar ni la venta de Yerba pueden aparecer: la venta no tiene proveedor.
 *
 * Los productos arrancan con stock 0 para que el alta no genere un movimiento
 * de stock inicial que sumaria una fila mas a cada reporte.
 */
export async function escenarioDeReporte(api) {
  const marca = `${Date.now() % 100000}${Math.floor(Math.random() * 90 + 10)}`;
  const comercio = `Almacén Reportes ${marca}`;

  await ponerNombreAlComercio(api, comercio);

  const yerba = await crearProductoViaApi(api, {
    nombre: `Yerba HU25 ${marca}`,
    stockActual: "0",
  });
  const azucar = await crearProductoViaApi(api, {
    nombre: `Azucar HU25 ${marca}`,
    stockActual: "0",
  });

  const yerbatera = await crearProveedorViaApi(api, {
    nombre: `Yerbatera HU25 ${marca}`,
  });
  const ingenio = await crearProveedorViaApi(api, {
    nombre: `Ingenio HU25 ${marca}`,
  });

  await crearCompraViaApi(api, {
    productoId: yerba.id,
    proveedorId: yerbatera.id,
    cantidad: 7,
  });
  await crearCompraViaApi(api, {
    productoId: azucar.id,
    proveedorId: ingenio.id,
    cantidad: 3,
  });
  await registrarMovimientoViaApi(api, {
    productoId: yerba.id,
    tipo: "venta",
    cantidad: 2,
  });

  return { comercio, yerba, azucar, yerbatera, ingenio };
}

/** `GET /api/reportes/movimientos` crudo, sin afirmar nada. */
export function pedirReporte(api, parametros, opciones = {}) {
  return api.get(RUTA_REPORTE, { params: parametros, ...opciones });
}

/**
 * Encabezado y cierre de un PDF bien formado, sin parsearlo. Que empiece con
 * `%PDF-` no alcanza: un archivo cortado a la mitad tambien empieza asi.
 */
export function tieneFormaDePdf(buffer) {
  return (
    buffer.subarray(0, 5).toString("latin1") === "%PDF-" &&
    buffer.subarray(-32).toString("latin1").includes("%%EOF")
  );
}

/**
 * El texto del PDF, con el parser que usa `Backend/tests/pdf.helper.js`
 * (pdf-parse, sobre pdf.js de Mozilla). Si el archivo no parsea, tira.
 *
 * Los espacios se colapsan: una linea larga —el "Rango aplicado", con la zona
 * horaria al final— puede partirse en dos renglones segun el ancho, y eso no es
 * lo que se prueba.
 */
export async function leerPdf(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const resultado = await parser.getText();
    return {
      texto: resultado.text.replace(/\s+/g, " "),
      paginas: resultado.total,
    };
  } finally {
    await parser.destroy();
  }
}
