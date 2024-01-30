# Frontlink

React realtime updates with your backend in a few lines of code. Heavily inspired by the [driftdb](https://driftdb.com) XD.

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

You can find a [minimal example React app here](https://github.com/danthegoodman1/frontlink-example) that includes a simple backend implementation.

## Uniquely naming shared states and functions

In order to prevent errors and potential undefined behavior of naming collisions, frontlink will NOT let you attach multiple active shared states or functions with the same room name. Frontlink will error in the console, and emit a `RoomCollisionPrevented` event.

You can still break this system if you're not careful: For example if you name state the same on different pages that are not supposed to be shared. It's very important to give unique room IDs to all shared states and functions. Clients will ignore updates from the opposite type however (they are aware what kind of share they have), so in theory you can share a name between a function and a state (but maybe don't anyway).

A few good tips are:

1. Never use a shared state/function within a component that can have multiple of itself rendered at the same time: If you are listing something, put the shared state at the level above, not in the listed components.
2. Name things based on their components and functionality: Instead of `useSharedState('count', 0)`, do something like `useSharedState('SpecificButtonOrPageCount', 0)` to prevent collisions.

## Auth

Because the `WebSocket` API doesn't allow passing in headers, we have to look at some other mechanism for auth.

If you know your auth info at connection time (e.g. you are using something like `<SignedIn>` with Clerk, then you can pass a token as part of your WebSocket url: `wss://yourapi.com/ws/<TOKEN>`. This method is greatly preferred, as you probably don't want unbound anonymous clients holding WebSocket connections.

If auth happens after WebSocket connection, you can fire a shared function to declare yourself (and thus allow your client to send/receive messages on your API):

```tsx
const authMe = useSharedFunction("authMe", (token: string) => {
  // do nothing, just for server
})
```

You can then emit your token. If you use this method, drop messages (and don't send) to unauthed clients rather than dropping connections or not allowing them in rooms.

## Listening to events

A [comprehensive suite of events](src/events.ts) are emitted for your app to react in response to.

## Building a backend

Messages are emitted to the backend as stringified JSON in the schema found in [`messages.ts`](/src/messages.ts).

Frontlink expects that joining a room will work regardless of auth state or permissions. It's up to you on the backend to determine whether it will be able to send/receive messages to a given room, as it will only ever resubscribe if the component unmounts and remounts.

### Basic flow

There are only a few critical pieces to building a minimal backend:

1. Clients connect to websocket - assign them some ClientID
2. Clients subscribe to a room - Store this client ID to that room until they unsubscribe ("room-client index"). Emit a `RoommateSubscribed` ([see schema](/src/messages.ts)) message to all but the new client if presence is relevant
3. Clients emit `SetState` and `CallFunction` messages to the backend. The backend should then relay these to all other connected clients in that room (do not send back to emitting client). Set the `ClientID` and `MessageMS` of the messages.
4. When clients unsubscribe from a room, remove them from the room-client index. Emit a `RoommateUnsubscribed` ([see schema](/src/messages.ts)) message to all but the new client if presence is relevant.
5. When clients disconnect, remove them from all room-client indexes

You can find a [minimal backend here](https://github.com/danthegoodman1/frontlink-example) for an example React app with an Express API. This implements simple room subscribe/unsubscribe, and relaying events to clients in the room. That is all you need!

### Seeding state

When a `useSharedState` or `useSharedFunction` is mounted, they will emit a `SubscribeState` and `SubscribeFunction` event respectively to the backend. For the `SubscribeState` event, the payload includes the `Value` property, which is the value of `JSON.stringify(initialValue)`. You can use this to seed the state for the room, and for clients that subsequently connect.

You can also seed the state on the client by immediately emitting a `SetState` message back to them to update their state.

### Emitting events from the server

You can choose to emit `SetState` and `CallFunction` messages from the server to subscribed clients. For example you may want real-time updates to clients based on actions from an admin panel, or some global event like a notification triggering a toast.

View [`messages.ts`](/src/messages.ts) for the schema of the JSON payload.

Ensure to set the `MessageMS` to the current time, and leave `ClientID` blank to indicate it's from the server (or set to some constant like `"server"`).

### Removing clients from a room on the server side

Just remove them from the room-client index and drop incoming messages to that room if the client does not belong to the room.

### Persisting room state

If you would like to persist `SetState` calls, it's best to process a room linearizably (in order) based on the order `SetState` events are received by the backend. When a room is ressurected, you can restore the state from persistent storage.

You can use non-linearizable datastores (e.g. S3, most databases) by processing them in order from memory. Based on your requirements, you can choose to collapse them to some interval so you are only writing once per interval (e.g. once per second).

When a client subscribes to a room, you can immediately serve it a `SetState` event to sync the state with the room.

### Presence

Use the `Emitter` import to listen for `RoommateSubscribe` and `RoommateUnsubscribe`:

```tsx
import { Emitter, EventTypes, Messages } from "frontlink"

Emitter.on(
  EventTypes.RoommateSubscribe,
  (msg: Messages.RoommateSubscribedMessage) => {
    // Present
  }
)

Emitter.on(
  EventTypes.RoommateUnsubscribe,
  (msg: Messages.RoommateUnsubscribedMessage) => {
    // Removed
  }
)
```
