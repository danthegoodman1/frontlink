# frontlink

## Getting started

First, install the `frontlink` package:

```
npm i frontlink
```

Next we need to wrap our components in a `FrontlinkProvider`. You can do this as far down as you need, and you may want to wait until you have known user information so you can attach auth to your URL.

```tsx
import { FrontlinkProvider } from "frontlink"

function App() {
  return (
    <FrontlinkProvider api="wss://yourapi.com">
      <RestOfYourApp />
    </FrontlinkProvider>
  )
}
```

Now we can use shared state within components!

```tsx
import { useSharedState } from "frontlink"

export default function SomeSharedComponent() {
  const { user } = getMyUser()

  const [roomName, setRoomName] = useSharedState("someRoomName", "local room")

  return <p>My room is {roomName}</p>
}
```

We can also used shared functions:

```tsx
import { useSharedState, useSharedFunction } from "frontlink"

export default function SomeSharedComponent() {
  const { user } = getMyUser()

  const [roomName, setRoomName] = useSharedState("someRoomName", "local room")

  const sharedFunc = useSharedFunction("sharedFunc", async (someArg) => {
    console.log("I did something cool (hey... who triggered this?)")
  })

  return (
    <>
      <p>My room is {roomName}</p>
      <button
        onClick={() => {
          sharedFunc()
        }}
      >
        Click me to do something cool
      </button>
    </>
  )
}
```

## Uniquely naming shared states and functions

In order to prevent errors and potential undefined behavior of naming collisions, frontlink will NOT let you attach multiple active shared states or functions with the same room name. Frontlink will error in the console, and emit a `RoomCollisionPrevented` event.

You can still break this system if you're not careful: For example if you name state the same on different pages that are not supposed to be shared. It's very important to give unique room IDs to all shared states and functions. Clients will ignore updates from the opposite type however (they are aware what kind of share they have), so in theory you can share a name between a function and a state (but maybe don't anyway).

A few good tips are:

1. Never use a shared state/function within a component that can have multiple of itself rendered at the same time: If you are listing something, put the shared state at the level above, not in the listed components.
2. Name things based on their components and functionality: Instead of `useSharedState('count', 0)`, do something like `useSharedState('SpecificButtonOrPageCount', 0)` to prevent collisions.

## Auth

Because the `WebSocket` API doesn't allow passing in headers, we have to look at some other mechanism for auth.

If you know your auth info at connection time (e.g. you are using something like `<SignedIn>` with Clerk, then you can pass a token as part of your WebSocket url: `wss://yourapi.com/ws/<TOKEN>`. This method is greatly preferred, as you probably don't want unbound anonymous clients holding WebSocket connections.

If auth happens after WebSocket connection, you can fire a shared function to delcare yourself (and thus allow your client to send/receive messages on your API):

```tsx
const authMe = useSharedFunction("authMe", (token: string) => {
  // do nothing, just for server
})
```

You can then emit your token. If you use this method, drop messages (and don't send) to unauthed clients rather than dropping connections or not allowing them in rooms.

Frontlink expects that joining a room will work regardless of auth state or permissions. It's up to you on the backend to determine whether it will be able to send/receive messages to a given room, as it will only ever resubscribe if the component unmounts and remounts.
