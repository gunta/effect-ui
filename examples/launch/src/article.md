---
title: Introducing Effect UI
---

Effect UI is a frontend library built on Effect and the Elm Architecture: self-contained Components with explicit state transitions and side effects as values. It continues the work of Foldkit 0.x ([foldkit.dev](https://foldkit.dev)), which we announced as the "new frontend foundation" in [Foldkit Joins Effect](https://foldkit.dev/blog/foldkit-joins-effect).

Effect UI is in public preview. If you're building with Foldkit 0.x, **the migration will be an upgrade, not a rewrite.**

We built this page with Effect UI. You can [read its source](https://github.com/Effect-TS/ui/tree/main/examples/launch) on GitHub.

## Explore with an AI agent

:::PageOnly
Not reading all that? Copy a prompt to explore it with an AI agent.
:::

:::AgentPrompts
::AgentPrompt{label="TL;DR" about="Paste into any AI agent that can read a web page." prompt="Read $URL. In under 200 words, explain what Effect UI is and list its key ideas and features, one line each. End with one sentence on how it relates to Foldkit 0.x. Use only what the page says, and say so when it doesn't cover something."}

::AgentPrompt{label="Your Foldkit 0.x app" about="Paste into a coding agent that is open in your Foldkit 0.x project." prompt="Read $URL. Then look at this Foldkit 0.x project and find the three places where Effect UI would simplify the code most. For each, name the files and say what would go away. Then sketch the smallest one as an Effect UI Component, using only APIs the page shows. Don't edit any files. Effect UI is in public preview and has no upgrade guide yet."}
:::

## What this article covers

Here's how Effect UI works, and the main changes from Foldkit 0.x:

- [Components](#components)
- [State and data](#state-and-data)
- [Views and rendering](#views-and-rendering)
- [Testing](#testing)
- [DevTools](#devtools)
- [Performance](#performance)

## Terms

- **Foldkit 0.x** is the existing frontend framework at [foldkit.dev](https://foldkit.dev).
- **Effect UI** is the new frontend library that continues the work of Foldkit 0.x. You import it from `@effect/ui`.
- **Foldkit** is the future full-stack framework. Effect UI will be its frontend.

## Components

Foldkit 0.x used the Elm Architecture, with the whole app as one program: one Model, one update and one view. That made every state change easy to follow, but it had costs as an app grew. Every Message ran the view from the root. Every parent stored state and forwarded Messages for its children. No part of an app could load in its own chunk.

Effect UI keeps the Elm Architecture and applies it to each Component. **A Component is an Elm Architecture program of its own, and you build an app by composing Components.**

::Architecture

A Component is self-contained. Its parent doesn't store its state or forward its Messages, so you can write and test it on its own. A Component can provide its own services and load in its own chunk. If a Component fails, the rest of the app keeps running.

### Anatomy of a Component

This counter shows the core parts of a Component. One definition holds its Model, Messages, init, update, subscriptions and view.

::Counter{code="intro" label="Live auto-counter"}

Click "+1", then click the Effect UI button in the bottom-right corner. [DevTools](#devtools) lists the Message you sent and what it changed.

**A Component works the same on every platform.** Only the platform-specific pieces change: the view elements, the host you mount onto and the effects that interact with them. For example, `Html.component` and `HtmlCommand.focus` target HTML, while `OpenTui.component` and `OpenTuiCommand.focus` in `@effect/ui-opentui` target the terminal.

### How Foldkit 0.x and Effect UI handle Messages

In Foldkit 0.x, every Message went through the root update and re-ran the view from the root. In Effect UI, the runtime delivers a Message straight to its Component's update and re-runs only that Component's view, skipping every parent.

::Diagram{scenario="messages"}

### Foldkit 0.x and Effect UI in code

Both examples below build a `Page` that shows or hides a `Counter`. **A parent no longer stores, wraps or forwards anything for its children.** Here, `Page` drops from 62 lines to 34, and `Counter`'s view only re-runs when its props change.

::Compare{foldkit="counterFoldkit" foldkitTitle="Foldkit 0.x: Page stores and forwards for Counter" effect="counterEffect" effectTitle="Effect UI: Page renders Counter" example="counter"}

### Organizing larger Components

As a Component grows, you can still move init, update, subscriptions and view into functions of their own. The Component definition's helpers supply their types, so you don't have to annotate them.

::Listing{code="split"}

## State and data

### Shared state with Providers

In Foldkit 0.x, a shared parent held state that several Submodels needed in its Model. Every parent between them passed that state down. To change it, a Submodel returned an OutMessage, and every parent forwarded it back up to the owner.

In Effect UI, a Provider shares part of its Model with Components inside it, at any depth. Components inside read that state and send the Provider Messages directly, without passing anything through the parents in between.

::Listing{code="provider"}

::Diagram{scenario="sharedState"}

### Data fetching with queries

In Foldkit 0.x, the Model held fetched data, and the parent managed the `Query`. The parent stored the query state, forwarded its Messages and decided when to load or refresh. In Effect UI, **you define a query once and list it on the Components that need it.** The runtime fetches the data and keeps it in one cache for every Component.

- **Fetching:** The runtime fetches when the Component renders, and again when the query's arguments change. Setting `debounce` waits until the arguments stop changing. Until the new result arrives, the last Success stays on screen with `waiting: true`.
- **Caching:** The runtime keeps one result per query and arguments. Components that ask for the same data share one fetch.
- **Freshness:** A result older than `staleTime` stays on screen while the runtime refetches it.
- **States:** Each result is an `AsyncResult`: either no result yet, failure or success.

::Chips{label="Also built into queries" items="polling, refetch on focus and reconnect, load more, invalidation from Commands, optimistic updates, prefetch on link hover, server rendering, restore on back and forward"}

::Compare{foldkit="queryFoldkit" foldkitTitle="Foldkit 0.x: The parent stores and manages the Query" effect="queryEffect" effectTitle="Effect UI: The Component lists its query"}

### Where state is stored

In Foldkit 0.x, one Model held all of an app's state. In Effect UI, state is stored in four places:

| State                                                             | Stored in                 |
| ----------------------------------------------------------------- | ------------------------- |
| A Component's own state                                           | Its own Model             |
| State a parent or a [Provider](#shared-state-with-providers) owns | Another Component's Model |
| Data a [query](#data-fetching-with-queries) fetched               | The runtime's query cache |
| Which Commands are running                                        | The runtime               |

A Model holds only the state that its own update changes, not everything the view shows. With logging enabled, you can still replay a Component's recorded Messages, because the log includes what update read from props, queries and Providers.

## Views and rendering

### Parts for headless Components

Headless Components in Effect UI manage behavior, keyboard handling and ARIA while you write the markup. Instead of returning markup of its own, a headless Component gives your view parts that you apply to your own elements, classes and children. Here, `Details` renders a `Disclosure`:

::Listing{code="partsUse"}

To write one, define `parts` instead of a view:

::Listing{code="partsDefine" whole="true"}

You can package your own reusable behavior the same way.

### The UI kit

**`@effect/ui-kit` already ships 42 components**, so you don't have to build accessible UI from scratch. The kit has every component in [Base UI](https://base-ui.com/), plus NavigationLinks, VirtualList, VirtualKeyboard, DirectionProvider and Positioning. They're all headless. Each handles keyboard, focus and ARIA while you write the markup and styles.

Here is the full set of 42 components. Hover or tap to animate.

::Kit

### Host-agnostic rendering

Effect UI renders through a host instead of tying Components to the browser DOM. The browser host renders DOM nodes, the server host writes HTML and the test host builds an in-memory tree, all from the same HTML Components.

Other platforms bring their own elements and host, like `@effect/ui-opentui` for the terminal, sharing the Component runtime without translating views across platforms. You pick the host when mounting the app, and the host interface is public if you want to write your own.

::Listing{code="mount"}

## Testing

### Story and Scene tests

A Story test sends Messages directly to a Component's update, and a Scene test drives it through the view. You pass the Component, and the test starts from its init Model, or a state you supply with `given`.

::Listing{code="tests"}

A test can also supply test values for everything around the Component: a query's result, a Subscription's value, an event from a child, a Provider's value or new props from the parent.

You can also replay a recorded session with `Story.fromLog`. When logging is enabled, the runtime records every Message a Component receives, along with the props, query results and Provider values its update read. `Story.fromLog` re-runs those Messages against update without running Commands, and reports the first step where the Component produces a different Model, Command or event.

### Play tests

Play is a new kind of test in Effect UI. In Story and Scene tests, you resolve each Command by hand, so the Command itself never runs. A Play test mounts the Component and its children on the [test host](#host-agnostic-rendering). It runs their real Commands, Subscriptions and query fetches against the Layers the test provides.

**A Play test can cover a whole flow.** It clicks a button, lets the real Command run and checks what is on screen afterwards, with no browser and no DOM.

`TestClock` controls time, so delayed flows run instantly without waiting in real time.

::PlayTest

## DevTools

:::LauncherPointer
Effect UI has an inspector that you add with one Layer, `DevTools.layer`. It's running on this page, behind the Effect UI button in the bottom-right corner.

- **Timeline:** One list holds every Message from every Component, the Model after it and what changed.
- **Cause and effect:** For any entry, DevTools traces what sent the Message, the Commands it issued and how each one ended.
- **Time travel:** Pick an earlier entry to see the page at that point. The live app keeps running, and Resume returns to it.
- **For agents:** An MCP server gives an agent the same view. It can read the log, inspect a Component's state and show the page at any entry. If you allow it, the agent can also send Messages.

:::

## Performance

In [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), Effect UI scored 1.52× vanilla JavaScript across the nine script operations, the lowest of the six frameworks we ran, compared to 6.69× for Foldkit 0.x. It reached first paint in 243 ms instead of 379 ms, and used 3.0 MB of memory with 1,000 rows instead of 6.1 MB. We ran all seven entries on the same machine.

::PerformanceChart

::AllResults

## Also new

- **Services per Component:** `Component.provide` gives services to a Component and everything below it. Its Commands and Subscriptions use them, and TypeScript reports a missing service at compile time.
- **Code splitting:** Load a Component from a chunk of its own with `Component.lazy`. The browser loads the chunk the first time the Component renders, so it stays out of the initial bundle.
- **Control overlapping Commands:** When an update issues a Command that is still running, use `concurrent` to run both, `switch` to interrupt the earlier run or `queue` to wait for it.

## What stays the same

Effect UI keeps these parts of Foldkit 0.x:

- **A constrained, agent-friendly architecture**
- **Predictable state changes**
- **Side effects as values that the runtime runs**
- **Clear, readable tests focused on behavior, not plumbing**
- **A Message log you can inspect and replay**

## Try a snapshot build

Effect UI isn't on npm yet. Every commit to `main` is published as a snapshot build on [pkg.pr.new](https://pkg.pr.new/~/Effect-TS/ui). To install the latest one:

```sh
pnpm add effect \
  @effect/ui@https://pkg.pr.new/Effect-TS/ui/@effect/ui@main \
  @effect/ui-kit@https://pkg.pr.new/Effect-TS/ui/@effect/ui-kit@main
```

To stay on one build, replace `main` with a commit's short SHA. You can ignore pnpm's unmet `@effect/ui` peer warning: `@effect/ui-kit` still uses the snapshot you installed.

To start a new app from Vite's `vanilla-ts` template, follow [Start a new app](https://github.com/Effect-TS/ui#start-a-new-app). `@effect/ui` ships its guide as `node_modules/@effect/ui/AGENTS.md`, so point your coding agent's instructions at that file.

The [examples](https://github.com/Effect-TS/ui/tree/main/examples) in the repository are complete apps you can read and run.

## What happens next

- **Public preview:** Effect UI doesn't have everything Foldkit 0.x has yet, and we're sharing it early so you can try the APIs and help shape it.
- **Keep building on Foldkit 0.x:** Feature work has moved to Effect UI, and Foldkit 0.x will keep getting critical bug fixes until Effect UI ships with an upgrade guide.
- **Issues and PRs:** Development happens in [Effect-TS/ui](https://github.com/Effect-TS/ui). We'll transfer relevant Foldkit issues and PRs there, so you don't need to open them again.

Thank you to everyone building with Foldkit 0.x. What you've made with it, and what you've told us along the way, is what Effect UI is built on.

:::Footer
We built this page with Effect UI. [Read the source](https://github.com/Effect-TS/ui/tree/main/examples/launch) in `examples/launch` in Effect-TS/ui.
:::
