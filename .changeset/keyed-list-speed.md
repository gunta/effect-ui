---
"@effect/ui": patch
---

Faster lists in `BrowserHost`. Rows of one shape are built by copying the first row's nodes and writing only the attributes and text that differ, and a copied row makes its records below the root on its first patch, so a long list keeps a few objects per row. A row whose nodes something other than the runtime changed is built again when it's patched. Two rows that trade places are moved without diffing the list, rows that `h.lazy` gives back unchanged are kept without a patch, and controlled properties are set again on kept nodes only once the tree has set a property.

Views build faster and keep fewer objects. Elements that hold only a class share one attribute record per class, an empty element with only shared attributes is one node for every row, a builder keeps its seldom-set fields (`eventOptions`, `refKey`, `mount`, `owned`, `hooks`, `removals`) in one record its copies share, and `h.lazy` drops the entries of replaced rows once they are as many as the ones in use, not on every render.

A builder a chain call of a library class returned is copied without counting its fields, so a field added to it afterwards under a string key isn't kept by the next chain call. One added to a builder made with `new`, or to one of your own builder class, still is.
