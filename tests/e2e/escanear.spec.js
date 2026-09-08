import { crearProductoViaApi } from "../soporte/datos.js";
import { expect, test } from "../soporte/fixtures.js";
import {
  generarCodigoEan13,
  generarVideoCamaraFalsa,
} from "./soporte/camara-falsa.js";
import { Escaner } from "./soporte/escaner.js";

/**
 * E2E de HU-10 — escaneo de código de barras con cámara real (simulada).
 *
 * Hasta ahora esto quedaba fuera de la suite a propósito: automatizarlo
 * necesita que el navegador tenga una cámara de verdad para que zxing
 * decodifique, y Playwright no puede sostener un código de barras físico
 * frente a una webcam. Chromium sí resuelve esto a nivel de proceso: con
 * `--use-fake-device-for-media-stream` + `--use-file-for-fake-video-capture`,
 * `getUserMedia` devuelve un `MediaStream` real leído de un archivo de video
 * en vez de hardware — zxing recibe frames indistinguibles de una cámara real
 * (ver `soporte/camara-falsa.js`, que arma ese archivo con un EAN-13 válido).
 *
 * El escenario es el de "producto ya existe" y no uno con sugerencia de Open
 * Food Facts a propósito: es el único de los dos que no depende de una API
 * externa de terceros, así que es el que puede correr en CI sin volverse
 * flaky por una consulta a un servicio que este equipo no controla.
 *
 * Como el resto de la suite (salvo `registro.spec.js`), usa el fixture
 * `comercio`: lo que se prueba acá es el escaneo, no el registro.
 */

const CODIGO = generarCodigoEan13();
const rutaVideo = await generarVideoCamaraFalsa(CODIGO);

test.use({
  launchOptions: {
    args: [
      // Sin esto Chromium muestra el prompt nativo de permiso de cámara y el
      // test queda colgado esperando un click que nadie va a dar.
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${rutaVideo}`,
    ],
  },
});

test.describe("HU-10 — Escaneo de código de barras", () => {
  test("escanea el código de un producto existente y entra a su detalle", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { codigoBarras: CODIGO });

    const escaner = new Escaner(page);
    await escaner.ir();
    await escaner.esperarProductoEncontrado();

    await expect(page.getByText(producto.nombre)).toBeVisible();
    await expect(page.getByText(`Código: ${CODIGO}`)).toBeVisible();

    await escaner.botonVerDetalle.click();

    await expect(
      page.getByRole("heading", { name: producto.nombre }),
    ).toBeVisible();
  });
});
