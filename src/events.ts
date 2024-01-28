import { Message } from "./messages"
import { RoomKind } from "./provider"

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
export const RoommateSubscribed = "RoommateSubscribed"
export const RoommateUnsubscribed = "RoommateUnsubscribed"
export const DuplicateMessageReceived = "DuplicateMessageReceived"

export interface EventPayload {
  /**
   * If the event is based on a WebSocket event, or failure processing a message
   */
  event?: MessageEvent<any>

  /**
   * If the event is based on the successfully parsed contents of a message
   */
  msg?: Message

  /**
   * If based on a room operation
   */
  roomID?: string
  /**
   * If based on a room operation
   */
  roomKind?: RoomKind
  /**
   * RoommateSubscribed and RoommateUnsubscribed events
   */
  clientID?: string
}
