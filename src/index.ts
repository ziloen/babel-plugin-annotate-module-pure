import type { NodePath, PluginObj, } from "@babel/core"
import type { CallExpression, Identifier, Node } from "@babel/types"
import { addComment, isIdentifier } from '@babel/types'


type PureCalls = Record<string, (string | string[])[]>

// https://github.com/merceyz/babel-plugin-optimize-clsx

/**
 * plugin options
 */
export type Options = {
  /**
   * List of module methods that should be annotated as pure.
   */
  pureCalls: PureCalls,
}


/**
 * Annotate module methods as pure.
 */
export default function annotateModulePure(): PluginObj {
  return {
    name: 'babel-plugin-annotate-module-pure',
    visitor: {
      CallExpression(path, state) {
        if (isPureCall(path, (state.opts as Options).pureCalls)) {
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
function isPureCall(path: NodePath<CallExpression>, PURE_CALLS: PureCalls): boolean {
  const calleePath = path.get('callee')

  if (calleePath.isIdentifier()) {
    for (const [module, methods] of Object.entries(PURE_CALLS)) {
      if (
        isReferencesImport(
          calleePath,
          module,
          methods.filter((m): m is string => typeof m === 'string')
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
function isReferencesImport(
  nodePath: NodePath<Identifier>,
  moduleSource: string,
  importedName: string | string[]
) {
  const binding = nodePath.scope.getBinding(nodePath.node.name)
  if (!binding || binding.kind !== 'module') return false

  const parent = binding.path.parentPath
  if (!parent || !parent.isImportDeclaration()) return false
  if (parent.node.source.value !== moduleSource) return false

  const path = binding.path

  if (path.isImportDefaultSpecifier() && importedName === 'default') return true

  if (path.isImportNamespaceSpecifier() && importedName === '*') return true

  if (path.isImportSpecifier()) {
    for (const name of Array.isArray(importedName)
      ? importedName
      : [importedName]) {
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
  return !!leadingComments &&
    leadingComments.some(comment => /[@#]__PURE__/.test(comment.value))
}
