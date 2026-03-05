const path = require('path');
const fs = require('fs');

const separator = path.sep;
const rootFolder = 'library';

module.exports = {
  parameters: null,
  inputs: null,
  dependencies: null,
  implementation: null,
  preCompileFunctions: {
    getYAMLs: async () => {
      const [dslCompiler] = Object.keys(require.cache)
        .filter(u => !u.split(separator).includes('node_modules'))
        .filter(u => u.split(separator).includes('dsl'))
        .filter(u => u.split(separator).includes('compiler.js'));
      if (!dslCompiler) return null;
      const compilerModule = require.cache[require.resolve(dslCompiler)];
      if (!compilerModule) return null;
      const { exports: { compile }, children } = compilerModule;
      if (!children.length) return null;
      return Object.fromEntries(await Promise.all(
        children.filter(({ id }) => id.split(separator).includes('extract.js'))
          .map(({ exports: { dependencies = {}, parameterValues = {} } }) => Object.keys(dependencies)
            .filter(key => typeof Object.getOwnPropertyDescriptor(dependencies, key)?.get !== 'function' && ['extraction', 'robot', 'schema'].includes(dependencies?.[key]?.split(':')?.[0]))
            .map(key => ({
              key,
              uri: dependencies[key],
              noGetParams: Object.fromEntries(
                Object.entries(parameterValues).filter(([keyP]) => typeof Object.getOwnPropertyDescriptor(parameterValues, keyP)?.get !== 'function'),
              ),
            })))
          .flat()
          .map(async ({ key, uri, noGetParams }) => {
            const compiled = await compile(uri, noGetParams);
            return [compiled?.modules?.[uri]?.implementation?.id, { key, ...compiled?.modules?.[uri]?.implementation?.config }];
          }),
      ));
    },
    getAllYAMLFilePaths: folderPath => fs.readdirSync(path.join(__dirname, '../', `.${folderPath}`), { withFileTypes: true })
      .filter(item => !item.isDirectory() && item.name.endsWith('.yaml'))
      .map(item => item.name.replace(/\.yaml$/, '')),
    getRobotTemplateName: () => {
      const rootPath = __dirname.split(separator)
        .slice(0, __dirname.split(separator).indexOf(rootFolder) + 1)
        .join(separator);
      return Object.keys(require.cache)
        .filter(u => !u.split(separator).includes('node_modules'))
        .filter(u => u.includes(rootPath))[0]
        ?.split(rootPath)
        ?.slice(-1)?.[0]
        ?.split(separator)
        ?.filter(u => !u.includes('.') && u !== 'variants')
        ?.join(separator);
    },
    getFolderPath: () => {
      const rootPath = __dirname.split(separator)
        .slice(0, __dirname.split(separator).indexOf(rootFolder) + 1)
        .join(separator);
      return Object.keys(require.cache)
        .filter(u => !u.split(separator).includes('node_modules'))
        .filter(u => u.includes(rootPath))[1]
        ?.split(rootPath)
        ?.slice(-1)?.[0]
        ?.split(separator)
        ?.filter(u => !u.includes('.') && u !== 'variants')
        ?.join(separator);
    },
    getCLIParams: () => Object.fromEntries(process.argv.join(' ').split(/--parameters/)?.[1]?.split(' -')?.[0]?.trim()?.split(' ')?.map(par => par.split('=')) || []),
  },
};
