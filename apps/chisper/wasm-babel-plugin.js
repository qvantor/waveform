// the bytes of a wasm core in a spec that imports a wasm worklet bundle (`import bytes from
// '@chisper/wasm/<name>.wasm'`), as esbuild's binary loader inlines them into the bundle: those of its perf build
// (tmp/wasm-perf, `npm run wasm`), read as the module loads. A Babel plugin of the specs, not a module mapped to the
// file: Jest (29.7 on) loads every .wasm file as an ES module
const { join } = require('path');

const WASM = /^@chisper\/wasm\/([\w-]+\.wasm)$/;
const DIRECTORY = join(__dirname, '../../tmp/wasm-perf');

module.exports = ({ types: t }) => ({
  visitor: {
    ImportDeclaration(path) {
      const match = WASM.exec(path.node.source.value);
      if (!match) return;
      const [specifier] = path.node.specifiers;
      if (path.node.specifiers.length !== 1 || !t.isImportDefaultSpecifier(specifier))
        throw path.buildCodeFrameError('a wasm core is imported as its bytes alone: import bytes from …');
      const read = t.callExpression(
        t.memberExpression(
          t.callExpression(t.identifier('require'), [t.stringLiteral('fs')]),
          t.identifier('readFileSync')
        ),
        [t.stringLiteral(join(DIRECTORY, match[1]))]
      );
      path.replaceWith(t.variableDeclaration('const', [t.variableDeclarator(specifier.local, read)]));
    },
  },
});
