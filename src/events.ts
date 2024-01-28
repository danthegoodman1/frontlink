export const MessageEmitted = "MessageEmitted"
/**
 * Deduplicated (will not emit this event when a duplicate event comes in)
 */
export const MessageReceived = "MessageReceived"
/**
 * When an incoming message fails to deserialize to JSON
 */
export const DeserializationError = "DeserializationError"
export const SocketClosed = "SocketClosed"
export const SocketError = "SocketError"
/**
 * When a state or function tries to subscribe to a room with the same name
 */
export const RoomCollisionPrevented = "RoomCollisionPrevented"
export const RoomSubscribed = "RoomSubscribed"
export const RoomUnsubscribed = "RoomUnsubscribed"
