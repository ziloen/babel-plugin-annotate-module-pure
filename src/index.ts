import type { NodePath, PluginObj, PluginPass } from '@babel/core'
import type {
  CallExpression,
  Identifier,
  MemberExpression,
  NewExpression,
  Node,
  OptionalCallExpression,
  OptionalMemberExpression,
} from '@babel/types'
import { addComment, isIdentifier } from '@babel/types'

// https://github.com/merceyz/babel-plugin-optimize-clsx
// https://github.com/lukeed/comptime

/**
 * List of module methods that should be annotated as pure.
 *
 * ```ts
 * import { method, object, object2 as alias } from "mod"
 * import defaultExport from "mod2"
 * import * as mod3 from "mod3"
 *
 * method()
 * object.path.to.method()
 * alias.path.to.method()
 * defaultExport.path.to.method()
 * mod3.method()
 * mod3.path.to.method()
 *
 * {
 *   "mod": [
 *     "method",
 *     ["object", "path", "to", "method"],
 *     ["object2", "path", "to", "method"]
 *   ],
 *   "mod2": [
 *     ["default", "path", "to", "method"]
 *   ],
 *   "mod3": [
 *     ["*", "method"],
 *     ["*", "path", "to", "method"]
 *   ]
 * }
 * ```
 */
type ModuleFunctions = Record<string, (string | string[])[]>

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
  function annotatePureCalls(
    path: NodePath<CallExpression | NewExpression | OptionalCallExpression>,
    state: PluginPass,
  ) {
    const opts = state.opts as Options
    const pureFunctions = opts.pureFunctions || opts.pureCalls

    if (pureFunctions && isPureCall(path, pureFunctions)) {
      annotateAsPure(path.node)

      path.node.extra = {
        ...path.node.extra,
        parenthesized: true,
      }
    }
  }

  return {
    name: 'babel-plugin-annotate-module-pure',
    visitor: {
      CallExpression: annotatePureCalls,
      OptionalCallExpression: annotatePureCalls,
      NewExpression: annotatePureCalls,
    },
  }
}

/**
 * Check if the call expression is maked as pure in the `pureFunctions` list.
 */
function isPureCall(
  path: NodePath<CallExpression | NewExpression | OptionalCallExpression>,
  pureFunctions: ModuleFunctions,
): boolean {
  const calleePath = path.get('callee')

  const pureFunctionsEntries = Object.entries(pureFunctions)

  if (calleePath.isIdentifier()) {
    for (const [module, methods] of pureFunctionsEntries) {
      const stringMethods = methods.filter((m) => typeof m === 'string')

      if (stringMethods.some((m) => calleePath.referencesImport(module, m))) {
        return true
      }
    }

    return false
  }

  const memberPath = getMemberPath(calleePath)
  if (!memberPath) return false
  const { properties, root } = memberPath

  for (const [module, methods] of Object.entries(pureFunctions)) {
    for (const method of methods) {
      if (typeof method === 'string') continue

      const [importedName, ...propertyPath] = method

      if (properties.length !== propertyPath.length) continue

      const isPathMatch = !properties.some((p, i) => p !== propertyPath[i])

      if (isPathMatch && root.referencesImport(module, importedName)) {
        return true
      }
    }
  }

  return false
}

/**
 * Get the member path of the callee.
 *
 * foo.bar.baz()
 * => { root: foo, properties: ['bar', 'baz'] }
 */
function getMemberPath(path: NodePath): {
  root: NodePath<Identifier>
  properties: string[]
} | null {
  const properties: string[] = []
  let current = path

  while (current.isMemberExpression() || current.isOptionalMemberExpression()) {
    if (current.node.computed) return null

    const prop = current.get('property') as
      | NodePath<MemberExpression['property']>
      | NodePath<OptionalMemberExpression['property']>
    if (!prop.isIdentifier()) return null

    properties.unshift(prop.node.name)
    current = current.get('object') as
      | NodePath<MemberExpression['object']>
      | NodePath<OptionalMemberExpression['object']>
  }

  // Check if root is an identifier
  if (!current.isIdentifier()) return null

  return { root: current, properties }
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
