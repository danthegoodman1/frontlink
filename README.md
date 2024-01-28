# frontlink

## Uniquely naming

In order to prevent errors and potential undefined behavior of naming collisions, frontlink will NOT let you attach multiple active shared states or functions with the same room name. Frontlink will error in the console, and emit a `RoomCollisionPrevented` event.

You can still break this system if you're not careful: For example if you name state in one room the same as a function in another. It's very important to give unique room IDs to all shared states and functions. If this does occur, and you have a shared name across a function and state, the clients will ignore updates from the opposite type however (they are aware what kind of share they have).

A few good tips are:

1. Never use a shared state/function within a component that can have multiple of itself rendered at the same time: If you are listing something, put the shared state at the level above, not in the listed components.
2. Name things based on their components and functionality: Instead of `useSharedState('count', 0)`, do something like `useSharedState('SpecificButtonClickCount', 0)` to prevent collisions.
