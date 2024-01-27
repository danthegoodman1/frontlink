# Contributing

## Room IDs and unique state/function names

The raw state/function name is used when messaging with the backend, as the message type natively handles dedupes between states and functions with the same name. The internal event emitter prepends a `StateUpdate::` or `CallFunction::` to the ID respectively so it's simple to distinguish
