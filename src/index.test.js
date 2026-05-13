import { fileURLToPath } from 'node:url'
import { transformAsync } from '@babel/core'
import test from 'node:test'
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

/**
 * @param {Options["preComputeFunctions"]} options
 * @param {string} input
 * @returns {Promise<string>}
 */
async function annotatePreCompute(options, input) {
  const result = await transformAsync(input, {
    ast: false,
    babelrc: false,
    configFile: false,
    filename: fileURLToPath(import.meta.url),
    plugins: [[plugin, { preComputeFunctions: options }]],
  })

  if (!result || !result.code) {
    throw new Error('Failed to transform')
  }

  return result.code
}

test('chained function', async (t) => {
  const input1 = `import { foo } from 'foo';\nfoo().bar();\nfoo.bar();`
  const expect = `import { foo } from 'foo';\n(/*#__PURE__*/foo()).bar();\n/*#__PURE__*/foo.bar();`

  const code = await annotatePure(
    {
      foo: ['foo', ['foo', 'bar']],
    },
    input1,
  )

  t.assert.equal(code, expect)
})

test('regular function', async (t) => {
  const input1 = `import { foo, bar } from 'foo';\nconst a = foo();\nbar();`
  const expect = `import { foo, bar } from 'foo';\nconst a = /*#__PURE__*/foo();\nbar();`

  const code = await annotatePure(
    {
      foo: ['foo'],
    },
    input1,
  )

  t.assert.equal(code, expect)
})

test('chained new expression', async (t) => {
  const input1 = `import { Foo } from 'foo';\nnew Foo().bar();\nFoo.bar();`
  const expect = `import { Foo } from 'foo';\n(/*#__PURE__*/new Foo()).bar();\n/*#__PURE__*/Foo.bar();`

  const code = await annotatePure(
    {
      foo: ['Foo', ['Foo', 'bar']],
    },
    input1,
  )

  t.assert.equal(code, expect)
})

test('new expression', async (t) => {
  const input1 = `import { Foo } from 'foo';\nconst a = new Foo();`
  const expect = `import { Foo } from 'foo';\nconst a = /*#__PURE__*/new Foo();`

  const code = await annotatePure(
    {
      foo: ['Foo'],
    },
    input1,
  )
  t.assert.equal(code, expect)
})

// --- pre-compute tests ---

test('pre-compute: simple string concatenation with all-literal args', async (t) => {
  const input = `import clsx from "clsx";\nclsx("foo", "bar");`
  const code = await annotatePreCompute(
    {
      clsx: ['default'],
    },
    input,
  )

  t.assert.equal(code, `import clsx from "clsx";\n"foo bar";`)
})

test('pre-compute: object-to-string conversion', async (t) => {
  const input = `import clsx from "clsx";\nclsx({ foo: true, bar: false });`
  const code = await annotatePreCompute(
    {
      clsx: ['default'],
    },
    input,
  )

  t.assert.equal(code, `import clsx from "clsx";\n"foo";`)
})

test('pre-compute: non-literal args fall back to pure annotation', async (t) => {
  const input = `import clsx from "clsx";\nclsx(condition && "foo", "bar");`
  const code = await annotatePreCompute(
    {
      clsx: ['default'],
    },
    input,
  )

  t.assert.equal(code, `import clsx from "clsx";\n/*#__PURE__*/clsx(condition && "foo", "bar");`)
})

test('pre-compute: mixed literal + non-literal args unchanged except pure annotation', async (t) => {
  const input = `import clsx from "clsx";\nclsx("foo", condition && "bar");`
  const code = await annotatePreCompute(
    {
      clsx: ['default'],
    },
    input,
  )

  t.assert.equal(code, `import clsx from "clsx";\n/*#__PURE__*/clsx("foo", condition && "bar");`)
})

test('pre-compute: numeric and null literal arguments', async (t) => {
  const input = `import clsx from "clsx";\nclsx(0, false, null, "bar");`
  const code = await annotatePreCompute(
    {
      clsx: ['default'],
    },
    input,
  )

  t.assert.equal(code, `import clsx from "clsx";\n"bar";`)
})

test('pre-compute: unknown module leaves call unchanged', async (t) => {
  const input = `import foo from "nonexistent-module-xyz";\nfoo("bar");`
  const code = await annotatePreCompute(
    {
      'nonexistent-module-xyz': ['default'],
    },
    input,
  )

  // Module can't be loaded, falls back to pure annotation only
  t.assert.equal(code, `import foo from "nonexistent-module-xyz";\n/*#__PURE__*/foo("bar");`)
})
