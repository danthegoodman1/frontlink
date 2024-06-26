export type MessageType =
  | "StateUpdate"
  | "CallFunction"
  | "SubscribeState"
  | "SubscribeFunction"
  | "UnsubscribeState"
  | "UnsubscribeFunction"
  | "RoommateSubscribed"
  | "RoommateUnsubscribed"

export interface Message {
  /**
   * A distinct ID generated by the client for deduplication
   */
  MessageID: string

  MessageType: MessageType

  /**
   * NOT IMPLEMENTED - Added by the server (so all clients have a timestamp to "agree" on.
   * This means that a client with a wonky clock will only impact itself,
   * not all other clients!
   */
  MessageMS: number
  /**
   * Added by the server, ID of the invoking client (undefined if sent by server)
   */
  ClientID?: string

  RoomID: string

  /**
   * If a `MessageType = 'StateUpdate'`, represents a serizable JSON value
   */
  Value?: any

  /**
   * If a `MessageType = 'CallFunction', the parameters of the called function
   */
  Args?: any[]
}

export interface SubscribeMessage extends Message {
  MessageType: "SubscribeState" | "SubscribeFunction"
}

export interface UnsubscribeMessage extends Message {
  MessageType: "UnsubscribeState" | "UnsubscribeFunction"
}

export interface StateUpdateMessage extends Message {
  MessageType: "StateUpdate"
  Value: string
}

export interface CallFunctionMessage extends Message {
  MessageType: "CallFunction"
  Args: any[]
}

export interface RoommateSubscribedMessage extends Message {
  MessageType: "RoommateSubscribed"
  ClientID: string
}

export interface RoommateUnsubscribedMessage extends Message {
  MessageType: "RoommateUnsubscribed"
  ClientID: string
}
