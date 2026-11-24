// Uso: node tests/run-node.js
import { resultados } from "./mini.js";
import "./evaluadores.test.js";

const fallas = resultados.filter(r => !r.ok);
for (const r of fallas) console.log(`FALLA  ${r.nombre}\n       ${r.error}`);
console.log(`${resultados.length - fallas.length}/${resultados.length} pruebas pasan`);
process.exit(fallas.length ? 1 : 0);
