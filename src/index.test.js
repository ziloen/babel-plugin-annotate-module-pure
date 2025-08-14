import { transformAsync } from '@babel/core'
import test from 'node:test'

/**
 * @import {Options} from "./index"
 */

/**
 * @param {Options["pureCalls"]} options
 * @param {string} input
 * @returns {Promise<string>}
 */
async function annotatePure(options, input) {
  const result = await transformAsync(input, {
    ast: false,
    babelrc: false,
    configFile: false,
    plugins: [['./dist/index.js', options]],
  })

  if (!result || !result.code) {
    throw new Error('Failed to tranform')
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
