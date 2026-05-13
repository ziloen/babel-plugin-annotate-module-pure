import { transformAsync } from '@babel/core'
import { test } from 'node:test'
import plugin from '../dist/index.js'

/**
 * @import {Options} from "./index"
 */

/**
 * @param {Options["pureFunctions"]} options
 * @param {string} input
 * @returns {Promise<string>}
 */
async function annotatePure(options, input) {
  const result = await transformAsync(input, {
    ast: false,
    babelrc: false,
    configFile: false,
    plugins: [[plugin, { pureFunctions: options }]],
  })

  if (!result || !result.code) {
    throw new Error('Failed to transform')
  }

  return result.code
}

test('regular function', async (t) => {
  const source = `import { foo, bar } from 'foo';\nconst a = foo();\nbar();`
  const expect = `import { foo, bar } from 'foo';\nconst a = /*#__PURE__*/foo();\nbar();`

  const code = await annotatePure(
    {
      foo: ['foo'],
    },
    source,
  )

  t.assert.strictEqual(code, expect)
})

test('chained function', async (t) => {
  const source = `import { foo } from 'foo';\nfoo().bar();\nfoo.bar();\nfoo.bar.baz();`
  const expect = `import { foo } from 'foo';\n(/*#__PURE__*/foo()).bar();\n/*#__PURE__*/foo.bar();\nfoo.bar.baz();`

  const code = await annotatePure(
    {
      foo: ['foo', ['foo', 'bar']],
    },
    source,
  )

  t.assert.strictEqual(code, expect)
})

test('default import', async (t) => {
  const source = `import foo from 'foo';\nfoo();\nfoo.bar();\nfoo.bar.baz();`
  const expect = `import foo from 'foo';\n/*#__PURE__*/foo();\n/*#__PURE__*/foo.bar();\nfoo.bar.baz();`

  const code = await annotatePure(
    {
      foo: ['default', ['default', 'bar']],
    },
    source,
  )

  t.assert.strictEqual(code, expect)
})

test('new expression', async (t) => {
  const source = `import { Foo } from 'foo';\nnew Foo();`
  const expect = `import { Foo } from 'foo';\n/*#__PURE__*/new Foo();`

  const code = await annotatePure(
    {
      foo: ['Foo'],
    },
    source,
  )
  t.assert.strictEqual(code, expect)
})

test('chained new expression', async (t) => {
  const source = `import { Foo } from 'foo';\nnew Foo().bar();\nFoo.bar();`
  const expect = `import { Foo } from 'foo';\n(/*#__PURE__*/new Foo()).bar();\n/*#__PURE__*/Foo.bar();`

  const code = await annotatePure(
    {
      foo: ['Foo', ['Foo', 'bar']],
    },
    source,
  )

  t.assert.strictEqual(code, expect)
})

test('namespace import', async (t) => {
  const source = `import * as foo from 'foo';\nfoo.bar();\nfoo.bar.baz();`
  const expect = `import * as foo from 'foo';\n/*#__PURE__*/foo.bar();\nfoo.bar.baz();`

  const code = await annotatePure(
    {
      foo: [['*', 'bar']],
    },
    source,
  )

  t.assert.strictEqual(code, expect)
})

test('optional call', async (t) => {
  const source = `import { foo } from 'foo';\nfoo.bar?.();`
  const expect = `import { foo } from 'foo';\n/*#__PURE__*/foo.bar?.();`

  const code = await annotatePure(
    {
      foo: [['foo', 'bar']],
    },
    source,
  )

  t.assert.strictEqual(code, expect)
})

test('optional chaining', async (t) => {
  const source = `import { foo } from 'foo';\nfoo?.bar?.();\nfoo?.bar?.baz();`
  const expect = `import { foo } from 'foo';\n/*#__PURE__*/foo?.bar?.();\n/*#__PURE__*/foo?.bar?.baz();`

  const code = await annotatePure(
    {
      foo: [
        ['foo', 'bar'],
        ['foo', 'bar', 'baz'],
      ],
    },
    source,
  )

  t.assert.strictEqual(code, expect)
})
