import { expect } from "@playwright/test";

/**
 * Page object de `/productos/escanear` (HU-10).
 *
 * `esperarProductoEncontrado` es la única espera no trivial: entre "entrar a
 * la pantalla" y "zxing decodificó el frame" pasan la negociación de
 * `getUserMedia`, el primer frame legible del video falso y el POST a
 * `GET /api/productos/codigo/:codigoBarras`. Nada de eso tiene una señal de
 * UI intermedia útil, así que se espera directo el resultado final con el
 * timeout largo que le da margen a esa cadena.
 */
export class Escaner {
  constructor(page) {
    this.page = page;

    this.encabezado = page.getByRole("heading", {
      name: "Escanear código de barras",
    });
    this.panelEncontrado = page.getByText("Este producto ya está en tu catálogo");
    this.botonVerDetalle = page.getByRole("button", { name: "Ver detalle" });
  }

  async ir() {
    await this.page.goto("/productos/escanear");
    await expect(this.encabezado).toBeVisible();
  }

  async esperarProductoEncontrado() {
    // Más margen que el default (10s, ver playwright.config.js): acá se sale
    // de lo que la app controla y se depende de que Chromium primero entregue
    // un frame legible del video falso a zxing.
    await expect(this.panelEncontrado).toBeVisible({ timeout: 20_000 });
  }
}
