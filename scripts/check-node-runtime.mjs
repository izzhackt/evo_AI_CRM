const expectedMajor = 22;
const expectedModuleVersion = "127";

const [major] = process.versions.node.split(".").map(Number);
const moduleVersion = process.versions.modules;

if (major !== expectedMajor || moduleVersion !== expectedModuleVersion) {
  console.error(
    [
      `Unsupported Node runtime: ${process.version} (NODE_MODULE_VERSION ${moduleVersion}).`,
      `This project must run on Node ${expectedMajor}.x (NODE_MODULE_VERSION ${expectedModuleVersion}).`,
      "better-sqlite3 is a native dependency; installing with a different Node version can produce a binary that crashes at login.",
      "Use the repo Node version first, then reinstall/rebuild dependencies: nvm use && npm ci",
    ].join("\n"),
  );
  process.exit(1);
}
