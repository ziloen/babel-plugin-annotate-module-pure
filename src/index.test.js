import test from 'node:test'
import { transform } from '@babel/core'

/**
 * @import {Options} from "./index"
 */

/**
 * 
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
      if (err) {
        return reject(err)
      }
      const { code } = result
      resolve(code)
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
  const input1 = `import { foo } from 'foo';\nconst a = foo();`
  const expect = `import { foo } from 'foo';\nconst a = /*#__PURE__*/foo();`

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