export enum EventType {
  MessageEmitted = 1,
  /**
   * Deduplicated (will not emit this event when a duplicate event comes in)
   */
  MessageReceived,
  /**
   * When an incoming message fails to deserialize to JSON
   */
  DeserializationError,
  SocketClosed,
  SocketError,
}
