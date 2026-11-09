// Metro читает общие чистые модули веба из <repo>/src (строки RU/KY, контент,
// библиотеки). Пакеты по-прежнему берутся из mobile/node_modules.
// Проверка допустимых импортов: scripts/check-shared-imports.mjs.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), path.join(repoRoot, "src")];
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules")];
// Пакеты, которые импортирует общий код веба, должны быть в mobile/package.json
// (это проверяет scripts/check-shared-imports.mjs), поэтому второго react не будет.

module.exports = config;
