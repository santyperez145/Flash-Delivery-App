import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { contains, readMobileSource } from "./source-contract.mjs";

const [app, roadmap, research] = await Promise.all([
  readMobileSource().then(({ source }) => source),
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
  assert.ok(contains(app, contract), `falta el contrato de acceso: ${contract}`);

assert.ok(
  !contains(app, 'setVerificationCode(registration.developmentCode||"")'),
  "registro no debe autocompletar el OTP de desarrollo",
);
assert.ok(
  !contains(app, 'setRecoveryToken(result.developmentToken||"")'),
  "recuperación no debe autocompletar el token de desarrollo",
);
assert.ok(
  contains(app, "await fetchWithTimeout(`${API_BASE}/auth/logout`"),
  "una sesión de la variante incorrecta debe revocarse",
);
assert.ok(
  contains(roadmap, "Acceso mobile competitivo y honesto"),
  "Design Roadmap no registra la nueva superficie",
);
assert.ok(
  contains(research, "Apple HIG") && contains(research, "Uber") && contains(research, "Lyft"),
  "la decisión no conserva referencias oficiales",
);

console.log("ok - acceso mobile progresivo, honesto y documentado");
