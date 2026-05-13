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
 *
 * {
 *   "mod": [
 *     "method",
 *     ["object", "path", "to", "method"],
 *     ["object2", "path", "to", "method"]
 *   ],
 *   "mod2": [
 *     ["default", "path", "to", "method"]
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
 * Check if the call expression is maked as pure in the PURE_CALLS list.
 * 1. import { method } from "module"; method()
 * 2. import { object } from "module"; object.path.to.method()
 * 3. import * as object from "module"; object.path.to.method()
 * 4. import object from "module"; object.path.to.method()
 * 5. import { object as alias } from "module"; alias.path.to.method()
 * 6. import { object } from "module"; object?.optional?.method?.()
 *
 * Not implemented:
 * 1. import { method as alias } from "module"; alias()
 */
function isPureCall(
  path: NodePath<CallExpression | NewExpression | OptionalCallExpression>,
  PURE_CALLS: ModuleFunctions,
): boolean {
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
  if ((calleePath.isMemberExpression() || calleePath.isOptionalMemberExpression()) && !calleePath.node.computed) {
    let objPath = calleePath

    while (true) {
      const propPath = objPath.get('property') as
        | NodePath<MemberExpression['property']>
        | NodePath<OptionalMemberExpression['property']>
      const nextObjPath = objPath.get('object') as
        | NodePath<MemberExpression['object']>
        | NodePath<OptionalMemberExpression['object']>

      if (!propPath.isIdentifier()) {
        return false
      }

      if (nextObjPath.isIdentifier()) {
        allProperties.unshift(propPath)
        allProperties.unshift(nextObjPath)
        break
      }

      if (
        (nextObjPath.isMemberExpression() || nextObjPath.isOptionalMemberExpression()) &&
        !nextObjPath.node.computed
      ) {
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
// https://github.com/babel/babel/blob/1e641a6b0b5195bfa48c5a73304e898d1d0b7226/packages/babel-traverse/src/path/introspection.ts#L147
function isReferencesImport(nodePath: NodePath<Identifier>, moduleSource: string, importedName: string | string[]) {
  const binding = nodePath.scope.getBinding(nodePath.node.name)
  if (!binding || binding.kind !== 'module') return false

  const parent = binding.path.parentPath
  if (!parent || !parent.isImportDeclaration()) return false
  if (parent.node.source.value !== moduleSource) return false

  const path = binding.path

  if (path.isImportDefaultSpecifier() && importedName === 'default') return true

  if (path.isImportNamespaceSpecifier() && importedName === '*') return true

  if (path.isImportSpecifier()) {
    for (const name of Array.isArray(importedName) ? importedName : [importedName]) {
      if (isIdentifier(path.node.imported, { name })) return true
    }
  }

  return false
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
