import { addComment, isIdentifier } from '@babel/types'

/**
 * @typedef {import("@babel/core").TransformOptions} TransformOptions
 * @typedef {import("@babel/types").CallExpression} CallExpression
 * @typedef {import("@babel/types").Identifier} Identifier
 * @typedef {import("@babel/types").Node} Node
 */

/**
 * @typedef {Record<string, (string | string[])[]>} PureCalls
 * @typedef {{ pureCalls: PureCalls }} Options
 */

/**
 * 
 * @returns {import("@babel/core").PluginObj}
 */
export default function annotateModulePure() {
  return {
    name: 'babel-plugin-annotate-module-pure',
    visitor: {
      CallExpression(path, state) {
        if (isPureCall(path, /** @type {Options} */(state.opts).pureCalls)) {
          annotateAsPure(path)
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
 * @param {import("@babel/core").NodePath<CallExpression>} path
 * @param {PureCalls} PURE_CALLS 
 * @returns {boolean}
 */
function isPureCall(path, PURE_CALLS) {
  const calleePath = path.get('callee')

  if (calleePath.isIdentifier()) {
    for (const [module, methods] of Object.entries(PURE_CALLS)) {
      if (
        isReferencesImport(
          calleePath,
          module,
          methods.filter(/** @return {m is string} */(m) => typeof m === 'string')
        )
      ) {
        return true
      }
    }

    return false
  }

  /** @type {import("@babel/core").NodePath<Identifier>[]} */
  const allProperties = []
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
 * 
 * @param {import("@babel/core").NodePath<Identifier>} nodePath 
 * @param {string} moduleSource 
 * @param {string | string[]} importedName 
 * @returns 
 */
function isReferencesImport(
  nodePath,
  moduleSource,
  importedName
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
 * 
 * @param {Node | import("@babel/core").NodePath} pathOrNode 
 * @returns {void}
 */
function annotateAsPure(pathOrNode) {
  const node =
    (pathOrNode['node'] || pathOrNode)
  if (isPureAnnotated(node)) {
    return
  }
  addComment(node, 'leading', PURE_ANNOTATION)
}

const PURE_ANNOTATION = '#__PURE__'

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isPureAnnotated({ leadingComments }) {
  return !!leadingComments &&
    leadingComments.some(comment => /[@#]__PURE__/.test(comment.value))
}
