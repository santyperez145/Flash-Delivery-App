// Preferencias de entrega (P-02): reglas y quién ve qué.
//
// Corre dentro de `test:authorization` porque la mitad de este módulo es una
// regla de visibilidad: qué parte de la casa de un cliente llega a cada rol.
import { describe, expect, it } from "vitest";

import {
  MAX_INDICACIONES,
  normalizarPreferencias,
  paraElComercio,
  paraRepartidorSinAsignar,
  preferenciasDesdeMetadata,
} from "../../server/delivery-preferences.js";

const pedido = (deliveryPreferences) => ({ id: "ORD-1", deliveryPreferences });

describe("normalizarPreferencias", () => {
  it("sin nada elegido, entrega en mano, sin indicaciones y sin cubiertos", () => {
    expect(normalizarPreferencias(undefined)).toEqual({
      dropoff: "hand_to_me",
      instructions: "",
      cutlery: false,
    });
  });

  it("acepta dejar en la puerta con indicaciones en un restaurante", () => {
    expect(
      normalizarPreferencias(
        { dropoff: "leave_at_door", instructions: "Timbre 3B", cutlery: true },
        { fulfillment: "delivery", vertical: "restaurant" },
      ),
    ).toEqual({ dropoff: "leave_at_door", instructions: "Timbre 3B", cutlery: true });
  });

  it("aplana saltos de línea, quita caracteres de control y recorta el largo", () => {
    const largo = "a".repeat(MAX_INDICACIONES + 50);
    expect(
      normalizarPreferencias({ instructions: "  piso 2\n\tpuerta\u0007 B  " }).instructions,
    ).toBe("piso 2 puerta B");
    expect(normalizarPreferencias({ instructions: largo }).instructions).toHaveLength(
      MAX_INDICACIONES,
    );
  });

  it("rechaza un modo desconocido", () => {
    expect(() => normalizarPreferencias({ dropoff: "drone" })).toThrow(/desconocido/);
  });

  it("en retiro no hay modo ni indicaciones de reparto, pero sí cubiertos", () => {
    expect(() =>
      normalizarPreferencias({ dropoff: "leave_at_door" }, { fulfillment: "pickup" }),
    ).toThrow(/retirar/);
    expect(() =>
      normalizarPreferencias({ instructions: "timbre" }, { fulfillment: "pickup" }),
    ).toThrow(/retirar/);
    expect(normalizarPreferencias({ cutlery: true }, { fulfillment: "pickup" }).cutlery).toBe(true);
  });

  it("no deja en la puerta en farmacia ni en tiendas, sí en súper y kiosco", () => {
    for (const vertical of ["pharmacy", "retail"])
      expect(() => normalizarPreferencias({ dropoff: "leave_at_door" }, { vertical })).toThrow(
        /puerta/,
      );
    for (const vertical of ["grocery", "kiosk"])
      expect(normalizarPreferencias({ dropoff: "leave_at_door" }, { vertical }).dropoff).toBe(
        "leave_at_door",
      );
  });

  it("los errores son 409, como la propina en retiro", () => {
    // Se captura y se afirma afuera: con el `expect` dentro del `catch`, una
    // función que dejara de lanzar pasaría la prueba sin ejecutar nada.
    let error = null;
    try {
      normalizarPreferencias({ dropoff: "leave_at_door" }, { vertical: "pharmacy" });
    } catch (capturado) {
      error = capturado;
    }
    expect(error?.status).toBe(409);
  });
});

describe("preferenciasDesdeMetadata", () => {
  it("un pedido anterior a P-02 se lee con valores seguros", () => {
    expect(preferenciasDesdeMetadata({})).toEqual({
      dropoff: "hand_to_me",
      instructions: "",
      cutlery: false,
    });
  });

  it("un valor guardado inválido no llega a la pantalla", () => {
    expect(
      preferenciasDesdeMetadata({
        deliveryPreferences: { dropoff: "drone", instructions: 42, cutlery: "sí" },
      }),
    ).toEqual({ dropoff: "hand_to_me", instructions: "", cutlery: false });
  });
});

describe("quién ve qué", () => {
  const completas = { dropoff: "leave_at_door", instructions: "Timbre 3B", cutlery: true };

  it("el comercio ve sólo los cubiertos", () => {
    const visto = paraElComercio(pedido(completas));
    expect(visto.deliveryPreferences).toEqual({ cutlery: true });
    expect(JSON.stringify(visto)).not.toContain("Timbre 3B");
    expect(JSON.stringify(visto)).not.toContain("leave_at_door");
  });

  it("un repartidor sin asignar ve el modo y que hay indicaciones, nunca el texto", () => {
    const visto = paraRepartidorSinAsignar(pedido(completas));
    expect(visto.deliveryPreferences).toEqual({ dropoff: "leave_at_door", hasInstructions: true });
    expect(JSON.stringify(visto)).not.toContain("Timbre 3B");
  });

  it("sin indicaciones, el repartidor sin asignar ve que no hay", () => {
    expect(
      paraRepartidorSinAsignar(pedido({ dropoff: "hand_to_me", instructions: "", cutlery: false }))
        .deliveryPreferences,
    ).toEqual({ dropoff: "hand_to_me", hasInstructions: false });
  });
});
