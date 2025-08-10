import test from 'node:test'
import { transform } from '@babel/core'

/**
 * @import {Options} from "./index"
 */

/**
 * @param {Options} options 
 * @param {string} input 
 * @returns {Promise<string>}
 */
function annotatePure(options, input) {
  return new Promise((resolve, reject) => {
    transform(input, {
      plugins: [
        ["./dist/index.js", options]
      ]
    }, (err, result) => {
      if (err || !result) {
        return reject(err)
      }
      resolve(result.code ?? "")
    })
  })

}


test("chained function", async (t) => {
  const input1 = `import { foo } from 'foo';\nfoo().bar();\nfoo.bar();`
  const expect = `import { foo } from 'foo';\n(/*#__PURE__*/foo()).bar();\n/*#__PURE__*/foo.bar();`

  const code = await annotatePure(
    {
      pureCalls: {
        foo: ["foo", ["foo", "bar"]]
      }
    },
    input1,
  )

  t.assert.equal(code, expect)
})

test("regular function", async (t) => {
  const input1 = `import { foo, bar } from 'foo';\nconst a = foo();\nbar();`
  const expect = `import { foo, bar } from 'foo';\nconst a = /*#__PURE__*/foo();\nbar();`

  const code = await annotatePure(
    {
      pureCalls: {
        foo: ["foo"]
      }
    },
    input1
  )

  t.assert.equal(code, expect)
})


test("chained new expression", async (t) => {
  const input1 = `import { Foo } from 'foo';\nnew Foo().bar();\nFoo.bar();`
  const expect = `import { Foo } from 'foo';\n(/*#__PURE__*/new Foo()).bar();\n/*#__PURE__*/Foo.bar();`

  const code = await annotatePure(
    {
      pureCalls: {
        foo: ["Foo", ["Foo", "bar"]]
      }
    },
    input1
  )

  t.assert.equal(code, expect)
})

test("new expression", async (t) => {
  const input1 = `import { Foo } from 'foo';\nconst a = new Foo();`
  const expect = `import { Foo } from 'foo';\nconst a = /*#__PURE__*/new Foo();`

  const code = await annotatePure(
    {
      pureCalls: {
        foo: ["Foo"]
      }
    },
    input1
  )
  t.assert.equal(code, expect)
})