// Conexiones NEMA de motores de 6 y 12 hilos. Portado tal cual del prototipo.
export const CONN = {
  "6": {
    "Estrella (Y)": "L1-T1   L2-T2   L3-T3\nUnir: T4-T5-T6",
    "Delta (Δ)": "L1-T1-T6   L2-T2-T4   L3-T3-T5"
  },
  "12": {
    "Y serie, alto voltaje": "L1-T1   L2-T2   L3-T3\nUnir: T4-T7  T5-T8  T6-T9\nUnir: T10-T11-T12",
    "YY paralelo, bajo voltaje": "L1-T1-T7   L2-T2-T8   L3-T3-T9\nUnir: T4-T5-T6  y  T10-T11-T12",
    "Δ serie, alto voltaje": "L1-T1-T12   L2-T2-T10   L3-T3-T11\nUnir: T4-T7  T5-T8  T6-T9",
    "ΔΔ paralelo, bajo voltaje": "L1-T1-T6-T7-T12   L2-T2-T4-T8-T10   L3-T3-T5-T9-T11"
  }
};

export const WINDINGS = {
  "6": ["T1-T4", "T2-T5", "T3-T6"],
  "12": ["T1-T4", "T2-T5", "T3-T6", "T7-T10", "T8-T11", "T9-T12"]
};

// Elevación permitida NEMA MG-1, FS 1.0, método de resistencia
export const CLASS_RISE = { A: 60, B: 80, F: 105, H: 125 };
