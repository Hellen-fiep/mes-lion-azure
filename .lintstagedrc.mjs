// lint-staged: antes de cada commit (hook do husky), formata e verifica somente os arquivos alterados da API.
// Os comandos rodam dentro de apps/api (npm exec --workspace), onde estão o eslint.config.mjs e o .prettierrc.
import path from 'node:path';

const API = 'apps/api';
const relativos = (arquivos) => arquivos.map((a) => JSON.stringify(path.relative(API, a))).join(' ');

export default {
  'apps/api/**/*.ts': (arquivos) => [
    `npm exec --workspace ${API} -- prettier --write ${relativos(arquivos)}`,
    `npm exec --workspace ${API} -- eslint --max-warnings=0 --no-warn-ignored ${relativos(arquivos)}`,
  ],
  'apps/api/**/*.{json,mjs,md,yml,prisma}': (arquivos) => [
    `npm exec --workspace ${API} -- prettier --write --ignore-unknown ${relativos(arquivos)}`,
  ],
};
