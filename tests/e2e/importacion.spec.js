import { expect, test } from "../soporte/fixtures.js";
import { crearProductoViaApi, leerStock } from "../soporte/datos.js";
import {
  CATALOGO_MIXTO,
  CATALOGO_PUNTO_Y_COMA,
  CATALOGO_SIN_CATEGORIA,
  CATALOGO_VALIDO,
  CODIGO_YA_EN_CATALOGO,
  verificarInvariante,
} from "../soporte/csv.js";
import { Catalogo } from "./soporte/catalogo.js";
import { Importacion } from "./soporte/importacion.js";

/**
 * E2E de HU-7 — importacion del catalogo inicial desde un CSV.
 * Subtarea de testing SCRUM-82.
 *
 * Corren contra el stack completo levantado con `docker compose up --build`: el
 * bundle de produccion del Frontend, servido por Nginx, hablando con el Backend
 * real y con Neon. El recorrido es el del usuario: elegir el archivo, mirar la
 * vista previa, confirmar y leer el reporte.
 *
 * Que NO se prueba aca: la lectura del CSV variante por variante ni la
 * validacion campo por campo —eso lo cubre Backend/tests/importacion.test.js—,
 * ni como pinta `ResumenImportacion` cada estado, que lo cubre
 * Frontend/src/components/ResumenImportacion.test.jsx. Lo que se verifica es
 * que la cadena completa funciona: un archivo real sube por la pantalla,
 * atraviesa Nginx, se procesa fila por fila y lo importado queda en el
 * catalogo con su stock.
 *
 * El caso 400 (falta una columna obligatoria) esta partido en dos a proposito:
 * aca se verifica que la pantalla lo frena *sin subir nada*, y en
 * tests/api/importacion-csv.spec.js que el backend igual lo rechaza con 400
 * cuando el pedido no viene de esta pantalla.
 *
 * Cada test trae su propio comercio con el catalogo vacio, asi que los codigos
 * de barras fijos de los CSV no chocan entre tests ni con las otras suites (ver
 * tests/soporte/csv.js). No hay nada que limpiar entre tests.
 */

test.describe("HU-7 — Importación de catálogo desde CSV", () => {
  test("importa un CSV válido completo y lo informa como archivo entero", async ({
    page,
  }) => {
    const importacion = new Importacion(page);

    // Se entra por el link del catalogo y no por la URL: confirma que la
    // pantalla es alcanzable para quien puede importar.
    await importacion.irDesdeElCatalogo();

    await importacion.elegir(CATALOGO_VALIDO);

    // La vista previa es un criterio de la historia: nada se manda al servidor
    // hasta que el usuario ve lo que va a subir y confirma.
    await expect(importacion.vistaPrevia).toBeVisible();
    await expect(
      page.getByText(`El archivo tiene ${CATALOGO_VALIDO.totalFilas} productos.`),
    ).toBeVisible();
    await expect(importacion.botonConfirmar).toHaveText(
      `Confirmar carga de ${CATALOGO_VALIDO.totalFilas} productos`,
    );

    // La columna `precio` no es un campo del producto, pero se muestra igual en
    // la previa: el backend la ignora sin rechazar el archivo.
    await expect(
      page.getByRole("columnheader", { name: "precio" }),
    ).toBeVisible();

    const reporte = await importacion.confirmar();

    verificarInvariante(reporte);
    expect(reporte.totalFilas).toBe(CATALOGO_VALIDO.totalFilas);
    expect(reporte.importados).toBe(CATALOGO_VALIDO.totalFilas);
    expect(reporte.fallidos).toBe(0);
    expect(reporte.interrumpido).toBe(false);

    // Lo que ve el usuario tiene que decir lo mismo que el contrato.
    await expect(importacion.resumen).toContainText(
      `Se importaron ${CATALOGO_VALIDO.totalFilas} productos: el archivo entró completo.`,
    );
    await expect(importacion.listaDeErrores).toHaveCount(0);

    // Cada fila importada vuelve con su numero de linea real del archivo (los
    // encabezados son la linea 1), que es lo unico que hace accionable el
    // reporte.
    expect(
      reporte.productos.map(({ fila, nombre, codigoBarras }) => ({
        fila,
        nombre,
        codigoBarras,
      })),
    ).toEqual(
      CATALOGO_VALIDO.productos.map(({ fila, nombre, codigoBarras }) => ({
        fila,
        nombre,
        codigoBarras,
      })),
    );
  });

  test("una fila inválida no aborta el archivo: las válidas entran igual", async ({
    page,
    api,
  }) => {
    // El unico andamiaje que necesita el archivo: el producto contra el que
    // choca su fila 6.
    await crearProductoViaApi(api, { codigoBarras: CODIGO_YA_EN_CATALOGO });

    const importacion = new Importacion(page);
    await importacion.ir();
    await importacion.elegir(CATALOGO_MIXTO);

    const reporte = await importacion.confirmar();

    verificarInvariante(reporte);
    expect(reporte.totalFilas).toBe(CATALOGO_MIXTO.totalFilas);
    expect(reporte.importados).toBe(CATALOGO_MIXTO.importados.length);
    expect(reporte.fallidos).toBe(CATALOGO_MIXTO.rechazos.length);
    expect(reporte.interrumpido).toBe(false);

    // El corazon de la historia: el archivo se proceso entero. La fila 8 es
    // valida y viene despues de las tres malas, asi que si un rechazo abortara
    // la carga, no estaria.
    expect(
      reporte.productos.map(({ fila, codigoBarras }) => ({ fila, codigoBarras })),
    ).toEqual(
      CATALOGO_MIXTO.importados.map(({ fila, codigoBarras }) => ({
        fila,
        codigoBarras,
      })),
    );

    // Y cada rechazo trae su fila y su motivo, los tres de familias distintas:
    // repetido en el archivo, ya existente en el catalogo, y dato invalido.
    expect(reporte.errores).toEqual(CATALOGO_MIXTO.rechazos);

    await expect(importacion.resumen).toContainText(
      `Se importaron ${CATALOGO_MIXTO.importados.length} de ${CATALOGO_MIXTO.totalFilas} productos.`,
    );
    await expect(importacion.resumen).toContainText(
      `${CATALOGO_MIXTO.rechazos.length} filas quedaron sin cargar.`,
    );

    // Los mismos rechazos, pero como los lee el comerciante para corregir la
    // planilla.
    for (const rechazo of CATALOGO_MIXTO.rechazos) {
      await expect(importacion.filaConError(rechazo)).toContainText(
        rechazo.motivo,
      );
    }

    // Y las que si entraron, tambien a la vista y con el numero de linea del
    // archivo: es lo que le confirma al usuario que no perdio esas cuatro.
    const importados = await importacion.verImportados(
      CATALOGO_MIXTO.importados.length,
    );

    for (const producto of CATALOGO_MIXTO.importados) {
      await expect(
        importados.filter({ hasText: `Fila ${producto.fila} · ` }),
      ).toContainText(producto.codigoBarras);
    }

    // En el catalogo quedan solo las cuatro validas mas el producto de
    // andamiaje: ninguna fila rechazada entro a medias.
    const catalogo = await (await api.get("/api/productos")).json();
    expect(catalogo).toHaveLength(CATALOGO_MIXTO.importados.length + 1);
  });

  test("los productos importados quedan en el catálogo con su fila de stock", async ({
    page,
    api,
  }) => {
    const importacion = new Importacion(page);
    await importacion.ir();
    await importacion.elegir(CATALOGO_VALIDO);

    const reporte = await importacion.confirmar();
    expect(reporte.importados).toBe(CATALOGO_VALIDO.totalFilas);

    // Se sale por el mismo boton que usaria el usuario para ir a ver lo que
    // cargo.
    await importacion.linkAlCatalogo.click();

    const catalogo = new Catalogo(page);
    await expect(catalogo.titulo).toBeVisible();
    await expect(catalogo.listaVacia).toHaveCount(0);

    // Cada producto se ve en el listado con su codigo de barras.
    for (const producto of CATALOGO_VALIDO.productos) {
      const fila = catalogo.fila(producto);
      await expect(fila).toBeVisible();
      await expect(fila).toContainText(producto.nombre);
      await expect(fila).toContainText(producto.codigoBarras);
    }

    const listado = await (await api.get("/api/productos")).json();
    expect(listado).toHaveLength(CATALOGO_VALIDO.totalFilas);

    // Y cada uno arranca con su fila en STOCK. El stock no se ve en el listado
    // (mostrarlo es HU-11), asi que el criterio se cierra contra el detalle.
    for (const esperado of CATALOGO_VALIDO.productos) {
      const creado = listado.find(
        (item) => item.codigoBarras === esperado.codigoBarras,
      );

      expect(
        creado,
        `«${esperado.nombre}» no quedó en el catálogo del comercio`,
      ).toBeTruthy();

      const stock = await leerStock(api, creado.id);

      // Una sola ubicacion —la «Principal» que crea el alta—, asi que el total
      // es esa fila. El caso del `stock_actual` vacio es el que importa: tiene
      // que quedar en 0 *con su fila creada*, no sin fila.
      expect(stock.porUbicacion).toHaveLength(1);
      expect(
        stock.total,
        `el stock inicial de «${esperado.nombre}» no es el del CSV`,
      ).toBe(esperado.stock);
    }
  });

  test("un CSV sin una columna obligatoria se frena en la pantalla, sin subir nada", async ({
    page,
  }) => {
    // El Frontend lee el archivo antes de mandarlo, asi que este caso ni
    // siquiera llega al backend. Que el endpoint igual lo rechace con 400 lo
    // verifica tests/api/importacion-csv.spec.js.
    const subidas = [];
    page.on("request", (pedido) => {
      if (pedido.url().includes("/api/productos/importar")) {
        subidas.push(pedido.url());
      }
    });

    const importacion = new Importacion(page);
    await importacion.ir();
    await importacion.elegir(CATALOGO_SIN_CATEGORIA);

    await expect(importacion.aviso).toHaveText(
      CATALOGO_SIN_CATEGORIA.avisoDeLaPantalla,
    );

    // Sin boton no hay forma de confirmar: el archivo no se puede subir aunque
    // se insista.
    await expect(importacion.botonConfirmar).toHaveCount(0);
    expect(subidas, "se subió un archivo que la pantalla debía frenar").toEqual(
      [],
    );
  });

  test("procesa igual un CSV exportado con punto y coma", async ({
    page,
    api,
  }) => {
    const importacion = new Importacion(page);
    await importacion.ir();
    await importacion.elegir(CATALOGO_PUNTO_Y_COMA);

    // Que la previa muestre una columna por campo es la senal de que el
    // separador se detecto: con `,` asumido, las seis columnas entrarian como
    // una sola con todo el texto pegado. El BOM que antepone Excel tampoco
    // puede quedar pegado al primer encabezado.
    await expect(
      page.getByRole("columnheader", { name: "nombre", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "codigo_barras", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        `El archivo tiene ${CATALOGO_PUNTO_Y_COMA.totalFilas} productos.`,
      ),
    ).toBeVisible();

    const reporte = await importacion.confirmar();

    verificarInvariante(reporte);
    expect(reporte.importados).toBe(CATALOGO_PUNTO_Y_COMA.totalFilas);
    expect(reporte.fallidos).toBe(0);

    await expect(importacion.resumen).toContainText(
      `Se importaron ${CATALOGO_PUNTO_Y_COMA.totalFilas} productos: el archivo entró completo.`,
    );

    // Los datos entraron enteros, no partidos ni con el BOM pegado al primer
    // nombre.
    const listado = await (await api.get("/api/productos")).json();

    for (const esperado of CATALOGO_PUNTO_Y_COMA.productos) {
      const creado = listado.find(
        (item) => item.codigoBarras === esperado.codigoBarras,
      );

      expect(creado, `no se importó «${esperado.nombre}»`).toBeTruthy();
      expect(creado.nombre).toBe(esperado.nombre);
    }
  });
});
