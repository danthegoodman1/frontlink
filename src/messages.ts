export type MessageType =
  | "StateUpdate"
  | "CallFunction"
  | "Subscribe"
  | "Unsubscribe"

export interface Message {
  /**
   * A distinct ID generated on the client at emission time
   */
  MessageID: string

  MessageType: MessageType

  /**
   * Added by the server (so all clients have a timestamp to "agree" on.
   * This means that a client with a wonky clock will only impact itself,
   * not all other clients!
   */
  MessageMS: number
  /**
   * Added by the server
   */
  ClientID: string

  RoomID: string

  /**
   * If a `MessageType = 'StateUpdate'`, what that value is,
   * with `JSON.stringify()` called on it
   */
  Value?: string

  /**
   * If a `MessageType = 'CallFunction', the parameters of the called function
   */
  Args?: string[]
}

export interface SubscribeMessage extends Message {
  MessageType: "Subscribe"
}

export interface UnsubscribeMessage extends Message {
  MessageType: "Unsubscribe"
}

export interface StateUpdateMessage extends Message {
  MessageType: "StateUpdate"
  Value: string
}

export interface CallFunctionMessage extends Message {
  MessageType: "CallFunction"
  Args: string[]
}
