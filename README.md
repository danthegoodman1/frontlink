# frontlink

## Uniquely naming

In order to prevent errors and potential undefined behavior of naming collisions, frontlink will NOT let you attach multiple active shared states or functions with the same room name. Frontlink will error in the console, and emit a `RoomCollisionPrevented` event.
