import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, api, roadmap, research] = await Promise.all([
  readFile(new URL("../apps/mobile/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/mobile/src/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../docs/DESIGN_ROADMAP.md", import.meta.url), "utf8"),
  readFile(
    new URL("../docs/competitive-research/mobile-authentication.md", import.meta.url),
    "utf8",
  ),
]);

for (const contract of [
  'useState<"email"|"password">("email")',
  'loginStep==="password"',
  "¿La olvidaste?",
  "Código de verificación",
  "Código de recuperación",
  "Crear una cuenta",
  "Acceso protegido",
  'keyboardShouldPersistTaps="handled"',
  'mobileAppVariant==="driver"',
  'mobileAppVariant==="merchant"',
])
  assert.ok(app.includes(contract), `falta el contrato de acceso: ${contract}`);

assert.ok(
  !app.includes('setVerificationCode(registration.developmentCode||"")'),
  "registro no debe autocompletar el OTP de desarrollo",
);
assert.ok(
  !app.includes('setRecoveryToken(result.developmentToken||"")'),
  "recuperación no debe autocompletar el token de desarrollo",
);
assert.ok(
  api.includes("await fetchWithTimeout(`${API_BASE}/auth/logout`"),
  "una sesión de la variante incorrecta debe revocarse",
);
assert.ok(
  roadmap.includes("Acceso mobile competitivo y honesto"),
  "Design Roadmap no registra la nueva superficie",
);
assert.ok(
  research.includes("Apple HIG") && research.includes("Uber") && research.includes("Lyft"),
  "la decisión no conserva referencias oficiales",
);

console.log("ok - acceso mobile progresivo, honesto y documentado");
