# babel-plugin-annotate-module-pure
 
Mark module method call as pure for tree shaking

## Usage

```json
{
  "plugins": [
    ["babel-plugin-annotate-module-pure", { 
      "pureCalls": {
        "react": [
          "cloneElement",
          "createContext",
          "createElement",
          "createFactory",
          "createRef",
          "forwardRef",
          "isValidElement",
          "lazy",
          "memo",
        ],
        "react-dom": ["createPortal"],
        "webextension-polyfill": [
          ["runtime", "getManifest"],
          ["runtime", "getURL"],
          ["default", "runtime", "getManifest"],
          ["default", "runtime", "getURL"],
        ],
      }
    }]
  ]
}
```

```ts
import { createContext } from "react"
import Browser, { runtime } from "webextension-polyfill"

const Ctx = createContext(null)
const imageUrl = Browser.runtime.getURL("image.png")
const videoUrl = runtime.getURL("")

// becomes 👇

const Ctx = /* #__PURE__ */ createContext(null)
const imageUrl = /* #__PURE__ */ Browser.runtime.getURL("image.png")
const videoUrl = /* #__PURE__ */ runtime.getURL("")


```