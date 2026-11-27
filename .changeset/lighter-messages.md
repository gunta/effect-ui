---
"@effect/ui": patch
---

Less work for each message and each render. Without a recorder attached, a render's start and end aren't logged; an update with no Commands skips issuing them; the update's context is made in one step; and the browser host's commit walks its open dialogs and popovers only when there are some. Clearing or replacing a list in an instance with no child components or mounts no longer visits each removed row. Template nodes and view helpers set their fields in their constructors, without an extra function defining them first.
