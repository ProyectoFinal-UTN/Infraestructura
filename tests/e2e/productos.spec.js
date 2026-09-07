import { expect, test } from "./soporte/fixtures.js";
import { Catalogo } from "./soporte/catalogo.js";
import { crearProductoViaApi, productoValido } from "./soporte/datos.js";

/**
 * E2E de HU-9 (SCRUM-21) — alta, validacion, edicion y baja de productos.
 * Subtarea de testing SCRUM-91.
 *
 * Corren contra el stack completo levantado con `docker compose up --build`:
 * el bundle de produccion del Frontend, servido por Nginx, hablando con el
 * Backend real y con Neon. Los cuatro casos son los criterios de aceptacion de
 * la HU, y se recorren por la interfaz.
 *
 * Que NO se prueba aca: las validaciones de la API una por una, el 409, los
 * 404, el multi-tenant y los roles. Eso ya lo cubre
 * Backend/tests/productos.test.js con supertest, mas rapido y con acceso a la
 * base. Repetirlo daria cobertura duplicada y peor. La API se usa como
 * andamiaje (armar el escenario) y para verificar lo que la UI no muestra.
 *
 * Cada test es independiente: trae su propio comercio con el catalogo vacio, y
 * los que necesitan un producto existente lo precargan por API en vez de
 * depender del test de alta. Se pueden correr sueltos, en cualquier orden y en
 * paralelo.
 */

test.describe("HU-9 — Catálogo de productos", () => {
  test("da de alta un producto con datos válidos y lo muestra en el listado", async ({
    page,
    api,
  }) => {
    const catalogo = new Catalogo(page);
    await catalogo.ir();
    await expect(catalogo.listaVacia).toBeVisible();

    const producto = productoValido({
      categoria: "Almacén",
      unidadMedida: "kg",
      umbralMinimo: "5",
      stockActual: "20",
    });

    await catalogo.abrirAlta();
    await catalogo.completar(catalogo.formularioAlta, producto);
    await catalogo.guardar(catalogo.formularioAlta);

    // El alta avisa; la edicion no. Es la unica operacion con `role="status"`.
    await expect(catalogo.mensajeExito).toHaveText(
      `«${producto.nombre}» se dio de alta correctamente.`,
    );
    await expect(catalogo.formularioAlta).toHaveCount(0);
    await expect(catalogo.listaVacia).toHaveCount(0);

    const fila = catalogo.fila(producto);
    await expect(fila).toBeVisible();
    await expect(fila).toContainText(producto.nombre);
    await expect(fila).toContainText(
      `${producto.categoria} · ${producto.codigoBarras}`,
    );
    await expect(fila).toContainText("Se mide en kg · avisar bajo 5");

    // El stock inicial no se ve en el listado (mostrarlo es HU-11), asi que el
    // criterio se cierra contra el detalle: es el unico dato del alta que la
    // pantalla no devuelve.
    const listado = await (await api.get("/api/productos")).json();
    const creado = listado.find(
      (item) => item.codigoBarras === producto.codigoBarras,
    );
    expect(creado, "el producto no quedó en el catálogo del comercio").toBeTruthy();

    const detalle = await (await api.get(`/api/productos/${creado.id}`)).json();
    expect(detalle.stock.total).toBe(20);
  });

  test.describe("rechaza datos incompletos o inválidos", () => {
    test("no guarda con los campos obligatorios vacíos", async ({ page }) => {
      const catalogo = new Catalogo(page);
      await catalogo.ir();
      await catalogo.abrirAlta();

      // Unidad de medida, umbral y stock arrancan con un valor por defecto
      // valido, asi que los obligatorios que quedan vacios son estos tres.
      await catalogo.guardar(catalogo.formularioAlta);

      await expect(catalogo.errorDeCampo("codigoBarras")).toHaveText(
        "Ingresá el código de barras.",
      );
      await expect(catalogo.errorDeCampo("nombre")).toHaveText(
        "Ingresá el nombre del producto.",
      );
      await expect(catalogo.errorDeCampo("categoria")).toHaveText(
        "Ingresá una categoría.",
      );

      // El formulario no se cierra, no hay aviso de alta y el catálogo sigue
      // vacío: no se guardó nada.
      await expect(catalogo.formularioAlta).toBeVisible();
      await expect(catalogo.mensajeExito).toHaveCount(0);
      await expect(catalogo.listaVacia).toBeVisible();
    });

    test("no guarda con un código de barras inválido", async ({ page }) => {
      const catalogo = new Catalogo(page);
      await catalogo.ir();
      await catalogo.abrirAlta();

      await catalogo.completar(catalogo.formularioAlta, {
        ...productoValido(),
        codigoBarras: "779ABC",
      });
      await catalogo.guardar(catalogo.formularioAlta);

      await expect(catalogo.errorDeCampo("codigoBarras")).toHaveText(
        "Tiene que ser de 6 a 64 dígitos, sin letras.",
      );
      await expect(catalogo.formularioAlta).toBeVisible();
      await expect(catalogo.listaVacia).toBeVisible();

      // Menos de 6 dígitos, misma regla. Corregir el campo limpia el error
      // anterior, así que si el nuevo aparece es porque se revalidó.
      await catalogo.completar(catalogo.formularioAlta, { codigoBarras: "12345" });
      await expect(catalogo.errorDeCampo("codigoBarras")).toHaveCount(0);

      await catalogo.guardar(catalogo.formularioAlta);
      await expect(catalogo.errorDeCampo("codigoBarras")).toHaveText(
        "Tiene que ser de 6 a 64 dígitos, sin letras.",
      );
      await expect(catalogo.listaVacia).toBeVisible();
    });

    test("muestra el rechazo del backend cuando el código ya existe", async ({
      page,
      api,
    }) => {
      // Este es el unico caso de rechazo que la UI no puede resolver sola:
      // recorre el camino completo hasta el 409 del backend y vuelve anclado
      // al campo del codigo, no como error general.
      const existente = await crearProductoViaApi(api);

      const catalogo = new Catalogo(page);
      await catalogo.ir();
      await catalogo.abrirAlta();

      await catalogo.completar(catalogo.formularioAlta, {
        ...productoValido({ codigoBarras: existente.codigoBarras }),
        nombre: "Otro producto con el mismo código",
      });
      await catalogo.guardar(catalogo.formularioAlta);

      await expect(catalogo.errorDeCampo("codigoBarras")).toHaveText(
        `Ya existe un producto con el código de barras "${existente.codigoBarras}"`,
      );
      await expect(catalogo.formularioAlta).toBeVisible();

      // Sigue habiendo un solo producto con ese código.
      await expect(catalogo.fila(existente)).toHaveCount(1);
    });
  });

  test("edita un producto existente", async ({ page, api }) => {
    const original = await crearProductoViaApi(api, {
      categoria: "Bebidas",
      unidadMedida: "unidad",
      umbralMinimo: "5",
    });

    const catalogo = new Catalogo(page);
    await catalogo.ir();
    await expect(catalogo.fila(original)).toBeVisible();

    await catalogo.botonEditar(original).click();
    await expect(catalogo.formularioEdicion).toBeVisible();

    // La edicion no toca cantidades: cambiar stock es HU-13 y el PUT del
    // backend lo rechaza, asi que el campo no existe en este modo.
    await expect(
      catalogo.formularioEdicion.getByLabel("Stock inicial"),
    ).toHaveCount(0);

    const editado = {
      ...original,
      nombre: `${original.nombre} (1 litro)`,
      categoria: "Bebidas sin alcohol",
      unidadMedida: "l",
      umbralMinimo: "12",
    };

    await catalogo.completar(catalogo.formularioEdicion, {
      nombre: editado.nombre,
      categoria: editado.categoria,
      unidadMedida: editado.unidadMedida,
      umbralMinimo: editado.umbralMinimo,
    });
    await catalogo.guardar(catalogo.formularioEdicion);

    await expect(catalogo.formularioEdicion).toHaveCount(0);

    const fila = catalogo.fila(editado);
    await expect(fila).toContainText(editado.nombre);
    await expect(fila).toContainText(
      `${editado.categoria} · ${editado.codigoBarras}`,
    );
    await expect(fila).toContainText("Se mide en l · avisar bajo 12");

    // El listado se recarga desde el servidor, asi que lo que se ve es lo que
    // quedo guardado: el nombre viejo ya no esta en ninguna fila.
    await expect(page.getByText(original.nombre, { exact: true })).toHaveCount(0);
  });

  test("elimina un producto con confirmación previa y desaparece del listado", async ({
    page,
    api,
  }) => {
    const producto = await crearProductoViaApi(api);

    const catalogo = new Catalogo(page);
    await catalogo.ir();
    await expect(catalogo.fila(producto)).toBeVisible();

    await catalogo.botonEliminar(producto).click();

    const confirmacion = catalogo.confirmacion(producto);
    await expect(confirmacion).toBeVisible();
    await expect(confirmacion).toContainText(
      "Deja de aparecer en el catálogo, pero su historial de movimientos se conserva.",
    );

    // Que la confirmacion sea "previa" de verdad se prueba cancelando: el
    // producto tiene que seguir ahi.
    await confirmacion.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirmacion).toHaveCount(0);
    await expect(catalogo.fila(producto)).toBeVisible();

    await catalogo.botonEliminar(producto).click();
    await confirmacion.getByRole("button", { name: "Sí, eliminar" }).click();

    // La baja no muestra aviso: la unica senal es que la fila se va.
    await expect(catalogo.fila(producto)).toHaveCount(0);
    await expect(catalogo.listaVacia).toBeVisible();

    // Sigue sin aparecer despues de recargar: se guardo, no es estado local.
    await catalogo.ir();
    await expect(catalogo.fila(producto)).toHaveCount(0);

    // Baja logica: sale de las lecturas normales aunque la fila siga en la
    // base con su historial (eso ultimo lo verifica el test de integracion del
    // Backend, que si tiene acceso a la base).
    expect((await api.get(`/api/productos/${producto.id}`)).status()).toBe(404);

    // Y el codigo de barras queda libre, porque el indice unique solo aplica a
    // los productos activos.
    const reemplazo = productoValido({
      codigoBarras: producto.codigoBarras,
      nombre: "Producto que reusa el código liberado",
    });
    await catalogo.abrirAlta();
    await catalogo.completar(catalogo.formularioAlta, reemplazo);
    await catalogo.guardar(catalogo.formularioAlta);

    await expect(catalogo.mensajeExito).toHaveText(
      `«${reemplazo.nombre}» se dio de alta correctamente.`,
    );
  });
});
