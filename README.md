# frontlink

## Uniquely naming

In order to prevent errors and potential undefined behavior of naming collisions, frontlink will NOT let you attach multiple active shared states or functions with the same room name. Frontlink will error in the console, and emit a `RoomCollisionPrevented` event.

You can still break this system if you're not careful: For example if you name state in one room the same as a function in another. It's very important to give unique room IDs to all shared states and functions.
