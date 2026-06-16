# babel-plugin-annotate-module-pure

Mark module method calls as `/*#__PURE__*/` for tree shaking.

Instructs bundlers (webpack, Rollup, etc.) that specific function calls from specified modules have no side effects, enabling dead code elimination.

## Install

```bash
npm install babel-plugin-annotate-module-pure --save-dev
```

## Usage

Add the plugin to your Babel configuration and specify which module methods should be annotated as pure:

```json
{
  "plugins": [
    ["babel-plugin-annotate-module-pure", {
      "pureFunctions": {
        "clsx": ["default"],
        "clsx/lite": ["default"],
        "react": ["createElement", "Fragment"],
        "react-dom": ["render"]
      }
    }]
  ]
}
```

### Configuration

#### `pureFunctions` (required)

A map from module names to the list of exported methods that should be annotated as pure.

| Import Style          | Config Key                     |
| --------------------- | ------------------------------ |
| Named import          | `"methodName"`                 |
| Default import        | `"default"`                    |
| Namespace import      | `"methodName"`                 |
| Chained method        | `["object", "path", "method"]` |

#### `pureCalls` (deprecated)

Alias for `pureFunctions`. Prefer `pureFunctions` for clarity.

### Examples

Given the configuration:

```json
{
  "pureFunctions": {
    "foo": [
      "foo",
      ["foo", "bar"],
      ["object2", "path", "to", "method"]
    ],
    "foo2": [
      "default",
      ["default", "path", "to", "method"]
    ],
    "foo3": [
      "method",
      ["path", "to", "method"]
    ]
  }
}
```

#### Named imports

```js
// Input
import { foo, bar, baz } from 'foo';
const a = foo();
bar();

// Output
import { foo, bar, baz } from 'foo';
const a = /*#__PURE__*/foo();
bar();
```

#### Chained function calls

```js
// Input
import { foo } from 'foo';
foo().bar();
foo.bar();
foo.bar.baz();

// Output
import { foo } from 'foo';
(/*#__PURE__*/foo()).bar();
/*#__PURE__*/foo.bar();
foo.bar.baz();
```

#### Default imports

```js
// Input
import foo from 'foo2';
foo();
foo.bar();
foo.bar.baz();

// Output
import foo from 'foo2';
/*#__PURE__*/foo();
/*#__PURE__*/foo.bar();
foo.bar.baz();
```

#### Namespace imports

```js
// Input
import * as foo from 'foo3';
foo.method();
foo.path.to.method();

// Output
import * as foo from 'foo3';
/*#__PURE__*/foo.method();
/*#__PURE__*/foo.path.to.method();
```

#### New expressions

```js
// Input
import { Foo } from 'foo';
new Foo();

// Output
import { Foo } from 'foo';
/*#__PURE__*/new Foo();
```

## Why?

Tree shaking relies on the bundler knowing whether a function call has side effects. By default, function calls are considered to have side effects and are kept in the bundle even if their return value is unused. The `/*#__PURE__*/` annotation tells the bundler that the call can be safely removed if its result is not used, reducing bundle size.

This plugin automates the annotation so you don't need to manually add `/*#__PURE__*/` comments throughout your code.

## When NOT to use

**Only annotate a function as pure when you are absolutely certain it has no side effects, or its side effects can be safely discarded.**

A `/*#__PURE__*/` annotation instructs the bundler that the entire call expression can be dropped if its return value is unused. If the function actually performs meaningful side effects — such as:

- Writing to the DOM
- Mutating external state
- Logging or analytics
- Registering event listeners
- Modifying global variables
- Making network requests

…then marking it as pure **will cause the call to be silently removed in production builds**, leading to subtle and hard-to-debug runtime issues.

### Rule of thumb

| Situation | Safe to annotate? |
| --------- | ----------------- |
| Pure computation, no external effects | ✅ Yes |
| Side effects that are intentionally discardable (e.g., dev-only warnings) | ✅ Yes |
| Unknown or uncertain side effects | ❌ No |
| Known side effects that must always execute | ❌ No |

When in doubt, don't annotate.

## API

### `pureFunctions`

Type: `Record<string, (string | string[])[]>`

A record keyed by module name. Each value is an array of method identifiers:

- **String** — marks a top-level named/default/namespace import method as pure (e.g., `"clsx"`)
- **String array** — marks a chained property access path as pure (e.g., `["foo", "bar", "baz"]` for `foo.bar.baz()`)

For default imports, use `"default"` as the first element.

## License

MIT
