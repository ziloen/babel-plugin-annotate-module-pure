import type { NodePath, PluginObj, PluginPass } from '@babel/core'
import type {
  CallExpression,
  Expression,
  Identifier,
  NewExpression,
  Node,
} from '@babel/types'
import { addComment, isIdentifier, valueToNode } from '@babel/types'
import { createRequire } from 'module'

/** Cache for loaded modules, keyed by absolute module path. */
const moduleCache = new Map<string, unknown>()

/**
 * List of module methods that should be annotated as pure.
 *
 * ```ts
 * import { method, object, object2 as alias } from "module"
 * import defaultExport from "module2"
 *
 * method()
 * object.path.to.method()
 * alias.path.to.method()
 * defaultExport.path.to.method()
 *
 * {
 *   "module": [
 *     "method",
 *     ["object", "path", "to", "method"],
 *     ["object2", "path", "to", "method"]
 *   ],
 *   "module2": [
 *     ["default", "path", "to", "method"]
 *   ]
 * }
 * ```
 */
type ModuleFunctions = Record<string, (string | string[])[]>

// https://github.com/merceyz/babel-plugin-optimize-clsx
// https://github.com/lukeed/comptime

/**
 * plugin options
 */
export type Options = {
  /**
   * List of module methods that should be annotated as pure.
   *
   * Alias for `pureFunctions` for backward compatibility.
   *
   * @deprecated Use `pureFunctions` instead.
   */
  pureCalls?: ModuleFunctions
  /**
   * List of module methods that should be annotated as pure.
   */
  pureFunctions?: ModuleFunctions

  /**
 
   * 
   * List of module methods that should be pre-computed at compile time.
   * 
   * Only literal arguments are supported, and the result will be replaced with the computed value.
   * 
   * @example
   * ```ts
   * import clsx from "clsx/lite"
   * 
   * clsx("foo", "bar")
   * // => "foo bar"
   * 
   * clsx({ foo: true, bar: false })
   * // => "foo"
   * 
   * clsx(condition && "foo", "bar")
   * // => clxs(condition && "foo", "bar")
   * // Not pre-computed because of the non-literal argument
   * 
   * {
   *   "clsx/lite": ["default"]
   * }
   * ```
   * @internal
   */
  preComputeFunctions?: ModuleFunctions
}

/**
 * Annotate module methods as pure.
 */
export default function annotateModulePure(): PluginObj {
  return {
    name: 'babel-plugin-annotate-module-pure',
    visitor: {
      CallExpression(path, state) {
        const options = state.opts as Options
        const pureFunctions = options.pureFunctions || options.pureCalls


        if (tryPreCompute(path, state)) {
          return
        }

        if (pureFunctions && isPureCall(path, pureFunctions)) {
          annotateAsPure(path.node)

          path.node.extra = {
            ...path.node.extra,
            parenthesized: true,
          }
        }
      },
      NewExpression(path, state) {
        const options = state.opts as Options
        const pureFunctions = options.pureFunctions || options.pureCalls

        if (!pureFunctions) return

        if (isPureCall(path, pureFunctions)) {
          annotateAsPure(path.node)

          path.node.extra = {
            ...path.node.extra,
            parenthesized: true,
          }
        }
      },
    },
  }
}

/**
 * Check if the call expression is maked as pure in the PURE_CALLS list.
 * 1. import { method } from "module"; method()
 * 2. import { object } from "module"; object.path.to.method()
 * 3. import * as object from "module"; object.path.to.method()
 * 4. import object from "module"; object.path.to.method()
 * 5. import { object as alias } from "module"; alias.path.to.method()
 *
 * Not implemented:
 * 1. import { method as alias } from "module"; alias()
 */
function isPureCall(path: NodePath<CallExpression | NewExpression>, PURE_CALLS: ModuleFunctions): boolean {
  const calleePath = path.get('callee')

  if (calleePath.isIdentifier()) {
    for (const [module, methods] of Object.entries(PURE_CALLS)) {
      if (
        isReferencesImport(
          calleePath,
          module,
          methods.filter((m): m is string => typeof m === 'string'),
        )
      ) {
        return true
      }
    }

    return false
  }

  const allProperties: NodePath<Identifier>[] = []
  if (calleePath.isMemberExpression() && !calleePath.node.computed) {
    let objPath = calleePath

    while (true) {
      const propPath = objPath.get('property')
      const nextObjPath = objPath.get('object')

      if (!propPath.isIdentifier()) {
        return false
      }

      if (nextObjPath.isIdentifier()) {
        allProperties.unshift(propPath)
        allProperties.unshift(nextObjPath)
        break
      }

      if (nextObjPath.isMemberExpression() && !nextObjPath.node.computed) {
        allProperties.unshift(propPath)
        objPath = nextObjPath
        continue
      }

      return false
    }
  }

  if (allProperties.length === 0) return false

  for (const [module, methods] of Object.entries(PURE_CALLS)) {
    for (const method of methods) {
      if (typeof method === 'string') continue

      if (
        method.every((method, index) => {
          // Skip the first property, it could be an alias or a default import
          // it will be checked later in isReferencesImport
          if (index === 0) return true
          return allProperties[index]?.node.name === method
        })
      ) {
        const firstProp = allProperties[0]
        if (!firstProp) continue
        const firstMethod = method[0]
        if (!firstMethod) continue

        if (isReferencesImport(firstProp, module, firstMethod)) {
          return true
        } else {
          continue
        }
      }
    }
  }

  return false
}

/**
 * Check if the identifier is a reference to an import.
 */
function isReferencesImport(nodePath: NodePath<Identifier>, moduleSource: string, importedName: string | string[]) {
  const binding = nodePath.scope.getBinding(nodePath.node.name)
  if (!binding || binding.kind !== 'module') return false

  const parent = binding.path.parentPath
  if (!parent || !parent.isImportDeclaration()) return false
  if (parent.node.source.value !== moduleSource) return false

  const path = binding.path

  const names = Array.isArray(importedName) ? importedName : [importedName]

  if (path.isImportDefaultSpecifier() && names.includes('default')) return true

  if (path.isImportNamespaceSpecifier() && names.includes('*')) return true

  if (path.isImportSpecifier()) {
    for (const name of names) {
      if (isIdentifier(path.node.imported, { name })) return true
    }
  }

  return false
}

/**
 * Try to evaluate a Babel AST node as a static JavaScript value.
 * Returns the value if the node is a pure literal, or `undefined` if not.
 */
function evaluateLiteral(node: Expression): { value: unknown } | undefined {
  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return { value: node.value }

    case 'NullLiteral':
      return { value: null }

    case 'RegExpLiteral':
      return { value: new RegExp(node.pattern, node.flags) }

    case 'BigIntLiteral':
      return { value: BigInt(node.value) }

    case 'TemplateLiteral': {
      if (node.expressions.length > 0) return undefined
      const value = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('')
      return { value }
    }

    case 'ArrayExpression': {
      const arr: unknown[] = []
      for (const element of node.elements) {
        if (!element) return undefined
        if (element.type === 'SpreadElement') return undefined
        const result = evaluateLiteral(element as Expression)
        if (!result) return undefined
        arr.push(result.value)
      }
      return { value: arr }
    }

    case 'ObjectExpression': {
      const obj: Record<string, unknown> = {}
      for (const prop of node.properties) {
        if (prop.type === 'SpreadElement') return undefined
        if (prop.type !== 'ObjectProperty' || prop.computed) return undefined

        let key: string
        if (prop.key.type === 'Identifier') {
          key = prop.key.name
        } else if (prop.key.type === 'StringLiteral') {
          key = prop.key.value
        } else {
          return undefined
        }

        const valueResult = evaluateLiteral(prop.value as Expression)
        if (!valueResult) return undefined
        obj[key] = valueResult.value
      }
      return { value: obj }
    }

    default:
      return undefined
  }
}

/**
 * Information about a matched pre-compute function call.
 */
interface PreComputeMatch {
  /** The module source (e.g. "clsx/lite"). */
  module: string
  /** The method path to the function on the module (e.g. ["default"] or ["object", "path", "to", "method"]). */
  methodPath: string[]
}

/**
 * Check if the call expression matches an entry in `preComputeFunctions`.
 * Returns match info (module + method path) or `null` if no match.
 */
function getPreComputeMatch(
  path: NodePath<CallExpression>,
  preComputeFunctions: ModuleFunctions,
): PreComputeMatch | null {
  const calleePath = path.get('callee')

  if (calleePath.isIdentifier()) {
    for (const [module, methods] of Object.entries(preComputeFunctions)) {
      for (const method of methods) {
        if (typeof method !== 'string') continue
        if (isReferencesImport(calleePath, module, method)) {
          return { module, methodPath: [method] }
        }
      }
    }
    return null
  }

  const allProperties: NodePath<Identifier>[] = []
  if (calleePath.isMemberExpression() && !calleePath.node.computed) {
    let objPath = calleePath

    while (true) {
      const propPath = objPath.get('property')
      const nextObjPath = objPath.get('object')

      if (!propPath.isIdentifier()) {
        return null
      }

      if (nextObjPath.isIdentifier()) {
        allProperties.unshift(propPath)
        allProperties.unshift(nextObjPath)
        break
      }

      if (nextObjPath.isMemberExpression() && !nextObjPath.node.computed) {
        allProperties.unshift(propPath)
        objPath = nextObjPath
        continue
      }

      return null
    }
  }

  if (allProperties.length === 0) return null

  for (const [module, methods] of Object.entries(preComputeFunctions)) {
    for (const method of methods) {
      if (typeof method === 'string') continue

      if (
        method.every((method, index) => {
          if (index === 0) return true
          return allProperties[index]?.node.name === method
        })
      ) {
        const firstProp = allProperties[0]
        if (!firstProp) continue
        const firstMethod = method[0]
        if (!firstMethod) continue

        if (isReferencesImport(firstProp, module, firstMethod)) {
          return { module, methodPath: method }
        }
      }
    }
  }

  return null
}

/**
 * Load a module and resolve a function from it by walking the method path.
 *
 * @param moduleSource - The module to require (e.g. "clsx/lite").
 * @param methodPath - The path to the function on the module (e.g. ["default"] or ["object", "path", "to", "method"]).
 * @param fromFilename - The file being transformed, used as the base for module resolution.
 * @returns The resolved function, or `null` if the module couldn't be loaded or the path doesn't exist.
 */
function resolveModuleFunction(
  moduleSource: string,
  methodPath: string[],
  fromFilename: string,
): ((...args: unknown[]) => unknown) | null {
  try {
    let cached = moduleCache.get(moduleSource)
    if (cached === undefined) {
      const req = createRequire(fromFilename)
      cached = req(moduleSource)
      moduleCache.set(moduleSource, cached)
    }

    let fn: unknown = cached

    // Handle the first key: if it's 'default' and the module itself is a function
    // (CJS interop where module.exports = fn), use the module directly.
    const firstKey = methodPath[0]
    if (firstKey === 'default' && typeof fn === 'function') {
      // Module is a function — use it as the default export
      // Continue with remaining keys
    } else if (firstKey !== undefined) {
      if (fn == null || typeof fn !== 'object') return null
      fn = (fn as Record<string, unknown>)[firstKey]
    }

    for (let i = 1; i < methodPath.length; i++) {
      const key = methodPath[i]!
      if (fn == null || typeof fn !== 'object') return null
      fn = (fn as Record<string, unknown>)[key]
    }

    if (typeof fn !== 'function') return null
    return fn as (...args: unknown[]) => unknown
  } catch {
    return null
  }
}

/**
 * Try to pre-compute a call expression at compile time.
 *
 * If all arguments are static literals, the actual module function is loaded
 * and called, and the CallExpression node is replaced with the result.
 *
 * Returns `true` if pre-computation succeeded, `false` otherwise.
 */
function tryPreCompute(
  path: NodePath<CallExpression>,
  state: PluginPass,
): boolean {
  const preComputeFunctions = (state.opts as Options).preComputeFunctions
  if (!preComputeFunctions || !state.filename) return false

  const match = getPreComputeMatch(path, preComputeFunctions)
  if (!match) return false

  // Check all arguments are static literals
  const argValues: unknown[] = []
  for (const arg of path.node.arguments) {
    if (arg.type === 'SpreadElement' || arg.type === "ArgumentPlaceholder") return false
    const result = evaluateLiteral(arg)
    if (!result) return false
    argValues.push(result.value)
  }

  // Resolve the function
  const fn = resolveModuleFunction(match.module, match.methodPath, state.filename)
  if (!fn) return false

  // Call the function
  let result: unknown
  try {
    result = fn(...argValues)
  } catch {
    return false
  }

  // Replace the node with the result value
  path.replaceWith(valueToNode(result))
  return true
}

/**
 * Annotate the node as pure.
 */
function annotateAsPure(node: Node): void {
  if (isPureAnnotated(node)) {
    return
  }
  addComment(node, 'leading', PURE_ANNOTATION)
}

const PURE_ANNOTATION = '#__PURE__'

/**
 * Check if the node is already annotated as pure.
 */
function isPureAnnotated({ leadingComments }: Node): boolean {
  return !!leadingComments && leadingComments.some((comment) => /[@#]__PURE__/.test(comment.value))
}
