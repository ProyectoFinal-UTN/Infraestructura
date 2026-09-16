import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

/**
 * Los CSV de la importacion de catalogo (HU-7) y lo que se espera de cada uno.
 *
 * Los archivos de `csv/` son estaticos y estan commiteados, no generados: son
 * exactamente la planilla que subiria un comercio, se revisan de un vistazo en
 * el PR, y `setInputFiles` los toma por ruta sin escribir nada en disco.
 *
 * Que puedan tener codigos de barras fijos no es un descuido: el indice unico
 * es `(comercio_id, codigo_barras)` y cada test corre en su propio comercio
 * (ver tests/soporte/fixtures.js), asi que dos tests con el mismo archivo, en
 * paralelo o no, nunca se ven entre si. Es la misma razon por la que esta suite
 * no limpia nada entre tests.
 *
 * Este modulo existe para que ningun spec repita un literal del archivo. Un
 * numero de fila o un codigo escrito a mano en la asercion se desincroniza el
 * dia que alguien agrega una fila al CSV, y el test pasa a verificar otra cosa
 * sin fallar.
 *
 * Vive en `tests/soporte/` y no en `tests/e2e/soporte/` porque lo usan las dos
 * suites: la de navegador sube los archivos por la pantalla y la de API los
 * postea directo al endpoint.
 */

function rutaDeFixture(archivo) {
  return fileURLToPath(new URL(`./csv/${archivo}`, import.meta.url));
}

/**
 * Un CSV de prueba: su ruta en disco y lo que el backend deberia contestar.
 *
 * `fila` es el numero de linea real del archivo, con los encabezados como
 * linea 1 — el mismo que devuelve el backend (`info.lines`) y el mismo que se
 * ve al abrirlo en Excel. Por eso la primera fila de datos siempre es la 2.
 */
function fixture(archivo, detalle) {
  return { archivo, ruta: rutaDeFixture(archivo), ...detalle };
}

/**
 * Catalogo 100% valido, con los encabezados escritos de todas las formas en las
 * que llega una planilla real: con acentos (`Categoría`), en camelCase
 * (`unidadMedida`), con mayusculas y espacios (`Umbral Mínimo`) y en snake_case
 * (`stock_actual`). La columna `precio` no es un campo del producto y tiene que
 * ignorarse sin rechazar el archivo.
 *
 * La fila 5 trae `stock_actual` vacio a proposito: vale 0, y aun asi el alta
 * tiene que crearle su fila de STOCK igual que a las demas.
 */
export const CATALOGO_VALIDO = fixture("catalogo-valido.csv", {
  totalFilas: 5,
  productos: [
    { fila: 2, nombre: "Yerba Playadito 1kg", codigoBarras: "7790895000782", stock: 24 },
    { fila: 3, nombre: "Fideos Matarazzo 500g", codigoBarras: "7790070410016", stock: 12 },
    { fila: 4, nombre: "Coca-Cola 1.5L", codigoBarras: "7790895001789", stock: 48 },
    { fila: 5, nombre: "Lavandina Ayudín 1L", codigoBarras: "7791290791107", stock: 0 },
    { fila: 6, nombre: "Galletitas Oreo x6", codigoBarras: "7790040991002", stock: 30 },
  ],
});

/**
 * El codigo de barras de la fila 6 del mixto, que tiene que estar YA cargado en
 * el comercio antes de importar. Es el unico dato del archivo que necesita
 * andamiaje: los otros dos rechazos se explican solos dentro del CSV.
 */
export const CODIGO_YA_EN_CATALOGO = "7790387099999";

/**
 * Catalogo con filas buenas y malas mezcladas — el corazon de HU-7: una fila
 * con error se informa pero NO frena el archivo.
 *
 * Los tres rechazos son de tres familias distintas a proposito:
 *
 * - fila 4: codigo repetido *dentro del mismo archivo* (lo ataja el chequeo
 *   previo del service, que puede decir en que fila venia).
 * - fila 6: codigo que ya existe *en el catalogo* (lo ataja el indice unico
 *   parcial de la base, que es el guardian real).
 * - fila 7: `categoria` vacia, o sea un dato invalido de la celda (lo ataja
 *   `validarDatosProducto`, la misma validacion que el alta de HU-9).
 *
 * Las cuatro validas estan intercaladas entre las malas, no todas al final:
 * asi, si una fila con error abortara el archivo, la fila 8 no entraria y el
 * test lo veria.
 */
export const CATALOGO_MIXTO = fixture("catalogo-mixto.csv", {
  totalFilas: 7,
  importados: [
    { fila: 2, nombre: "Arroz Gallo Oro 1kg", codigoBarras: "7790387012345", stock: 20 },
    { fila: 3, nombre: "Aceite Natura 900ml", codigoBarras: "7790387012352", stock: 15 },
    { fila: 5, nombre: "Azúcar Ledesma 1kg", codigoBarras: "7790387012369", stock: 18 },
    { fila: 8, nombre: "Harina Pureza 1kg", codigoBarras: "7790387012383", stock: 25 },
  ],
  // Los motivos se copian literales de los que arma el backend
  // (productosImportacion.service.js y productos.service.js). Si alguno cambia,
  // el test tiene que fallar: es texto que el comerciante lee para corregir su
  // planilla, no un detalle interno.
  rechazos: [
    {
      fila: 4,
      codigoBarras: "7790387012345",
      motivo:
        'El código de barras "7790387012345" está repetido en el archivo: ya venía en la fila 2',
    },
    {
      fila: 6,
      codigoBarras: CODIGO_YA_EN_CATALOGO,
      motivo: `Ya existe un producto con el código de barras "${CODIGO_YA_EN_CATALOGO}"`,
    },
    {
      fila: 7,
      codigoBarras: "7790387012376",
      motivo:
        "La categoría es obligatoria y debe tener hasta 100 caracteres",
    },
  ],
});

/**
 * El mismo catalogo que exporta Excel en configuracion regional es-AR:
 * separador `;` (porque la coma es el separador decimal) y BOM UTF-8 adelante.
 *
 * Los dos detalles son los que rompen una importacion en la vida real y no se
 * ven al abrir el archivo: el BOM se pega al primer encabezado y hace que
 * `nombre` deje de matchear, con un caracter invisible como unica pista.
 */
export const CATALOGO_PUNTO_Y_COMA = fixture("catalogo-punto-y-coma.csv", {
  totalFilas: 3,
  productos: [
    { fila: 2, nombre: "Pan Lactal Bimbo", codigoBarras: "7791234500011", stock: 14 },
    { fila: 3, nombre: "Leche La Serenísima 1L", codigoBarras: "7791234500028", stock: 30 },
    { fila: 4, nombre: "Manteca Sancor 200g", codigoBarras: "7791234500035", stock: 8 },
  ],
});

/**
 * Archivo sin la columna `categoria`: sus tres filas son perfectamente validas,
 * lo que esta mal es el archivo entero. Tiene que dar 400, no un 200 con tres
 * errores de fila.
 */
export const CATALOGO_SIN_CATEGORIA = fixture("catalogo-sin-categoria.csv", {
  totalFilas: 3,
  // Lo que contesta el backend (400) y lo que avisa el Frontend sin llegar a
  // subir nada, que son textos distintos escritos por cada lado.
  errorDelBackend: "Al archivo le faltan columnas obligatorias: categoria",
  avisoDeLaPantalla:
    "Al archivo le falta una columna obligatoria: categoria. Agregala y volvé a elegir el archivo.",
});

/**
 * Postea un CSV al endpoint de importacion, sin afirmar nada sobre la
 * respuesta.
 *
 * El campo tiene que llamarse `archivo`: es lo que espera `multer.single` en
 * `subidaCsv.middleware.js`, y mandarlo con otro nombre da 400.
 *
 * `contenido` permite mandar algo que no salga de un fixture (un archivo
 * vacio), sin tener que commitear un .csv de cero bytes que cualquier editor o
 * linter puede "arreglar" sin que nadie lo note.
 */
export function importarCsv(api, { ruta, archivo, contenido } = {}) {
  return api.post("/api/productos/importar", {
    multipart: {
      archivo: {
        name: archivo,
        mimeType: "text/csv",
        buffer: contenido ?? readFileSync(ruta),
      },
    },
  });
}

/**
 * El invariante del contrato de HU-7, verificado en TODO 200 que produzca la
 * suite (los de la API y los que captura la pantalla).
 *
 * `importados + fallidos === procesadas` vale siempre; `procesadas` coincide
 * con `totalFilas` solo si la importacion no se interrumpio. Los dos
 * denominadores conviven a proposito en el reporte —`ResumenImportacion` los
 * usa para cosas distintas—, asi que confundirlos es un error que puede pasar
 * inadvertido: esto lo ancla.
 */
export function verificarInvariante(reporte) {
  expect(
    reporte.importados + reporte.fallidos,
    `importados (${reporte.importados}) + fallidos (${reporte.fallidos}) ` +
      `tiene que dar procesadas (${reporte.procesadas})`,
  ).toBe(reporte.procesadas);

  expect(reporte.importados).toBe(reporte.productos.length);
  expect(reporte.fallidos).toBe(reporte.errores.length);

  if (reporte.interrumpido) {
    // Un corte deja filas sin mirar y tiene que decir donde paro.
    expect(reporte.procesadas).toBeLessThan(reporte.totalFilas);
    expect(reporte.interrupcion).toMatchObject({ fila: expect.any(Number) });
  } else {
    expect(reporte.procesadas).toBe(reporte.totalFilas);
    expect(reporte.interrupcion).toBeNull();
  }
}
