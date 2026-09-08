# Hosted access UI

Serve this directory using the preview command below, then open `centered.html`, `split.html`, or `sheet.html`. Each static mock shows signed out, pending admission, unavailable, and loading states. The shared app stylesheet supplies the theme tokens. The theme toggle affects only the preview; action buttons are inert.

A centered panel keeps attention on the next action and fits a narrow screen. The split layout adds a product introduction but needs more space. The compact sheet is closer to a document and has a lighter visual boundary.

The director selected the centered panel after inspecting all three mocks. Component contract:

```ts
type HostedAccessScreenProps =
  | { status: "loading" }
  | { status: "signed-out"; onSignIn: () => void; busy?: boolean }
  | { status: "pending-admission"; onSignOut: () => void; busy?: boolean }
  | { status: "unavailable"; onRetry: () => void; busy?: boolean };
```

The caller supplies the verified state and handles actions. `busy` disables the current action while it is in flight. The component does not verify identity, grant admission, fetch data, handle tokens, or use browser storage. It has no workspace children or admitted branch.

Integration must resolve hosted access before constructing the app runtime. Unavailable does not mean signed out. Signing in does not grant DashFrame access. Bootstrap and runtime integration remain owned by the director.

To inspect the actual React component with the app stylesheet, run from the repository root:

```sh
bunx vp dev --config packages/app/design/hosted-access/preview.config.ts
```

Open `http://127.0.0.1:4382/component.html`. The preview controls select a state, theme, or busy action. Each action records its label and enters the busy state; it performs no authentication or navigation. This authored preview is separate from the app bootstrap.
