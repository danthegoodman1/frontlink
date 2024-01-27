import React, {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { EventEmitter } from "events"

import {
  CallFunctionMessage,
  Message,
  StateUpdateMessage,
  SubscribeMessage,
  UnsubscribeMessage,
} from "./messages"
import { EventType } from "./events"

interface FrontlinkState {
  conn: WebSocket
  subscribeToRoom(roomID: string): void
  unsubFromRoom(roomID: string): void
  emitSetState(stateID: string, value: any): void
  emitCallFunction(functionID: string, value: string[]): void
  /**
   * Number of dependent states or functions on a room
   */
  connectedRooms: Map<string, number>
}

function generateID(): string {
  // TODO: generate ID
  return ""
}

export const Emitter = new EventEmitter()
const internalEmitter = new EventEmitter()

export function FrontlinkProvider(
  props: PropsWithChildren<{
    api: string
  }>
) {
  const conn = useRef<WebSocket | null>(null)
  const subscribedRooms = useRef<Map<string, number> | null>(null)
  const msgDedupe = useRef<Set<string> | null>(null)

  if (conn.current === null) {
    conn.current = new WebSocket(props.api)
    conn.current.onmessage = (event) => {
      let msg: Message
      try {
        msg = JSON.parse(event.data)
      } catch (error) {
        Emitter.emit(EventType.DeserializationError, {
          // TODO: type this? is this correct payload?
          event,
        })
        return
      }

      // TODO: handle message
    }
    conn.current.onclose = (event) => {
      Emitter.emit(EventType.SocketClosed, {
        event,
      })
    }
    conn.current.onerror = (event) => {
      Emitter.emit(EventType.SocketError, {
        event,
      })
    }
  }

  if (subscribedRooms.current === null) {
    subscribedRooms.current = new Map<string, number>()
  }

  if (msgDedupe.current === null) {
    msgDedupe.current = new Set<string>()
  }

  function emitMessage(msg: Omit<Message, "MessageMS">) {
    if (conn.current === null || msgDedupe.current === null) {
      return
    }

    // Dedupe the message locally so we ignore it
    msgDedupe.current.add(msg.MessageID)

    // Send to socket
    conn.current.send(JSON.stringify(msg))
    Emitter.emit(EventType.MessageEmitted, {
      msg,
    })
  }

  function emitSetState(roomID: string, val: any) {
    emitMessage({
      MessageID: generateID(),
      RoomID: roomID,
      Value: JSON.stringify(val),
    } as Omit<StateUpdateMessage, "MessageMS">)
  }

  function emitCallFunction(roomID: string, ...args: any[]) {
    emitMessage({
      MessageID: generateID(),
      RoomID: roomID,
      Args: args.map((arg) => JSON.stringify(arg)),
    } as Omit<CallFunctionMessage, "MessageMS">)
  }

  function subscribeToRoom(roomID: string) {
    if (subscribedRooms.current === null || conn.current === null) {
      return
    }

    if (!subscribedRooms.current.has(roomID)) {
      subscribedRooms.current.set(roomID, 0)
      emitMessage({
        MessageType: "Subscribe",
        MessageID: generateID(),
        RoomID: roomID,
      } as Omit<SubscribeMessage, "MessageMS">)
    }

    subscribedRooms.current.set(
      roomID,
      (subscribedRooms.current.get(roomID) ?? 0) + 1
    )
  }

  function unsubFromRoom(roomID: string) {
    if (subscribedRooms.current === null || conn.current === null) {
      return
    }

    if (!subscribedRooms.current.has(roomID)) {
      console.warn(
        "tried to unsub from room",
        roomID,
        "without any existing known connections"
      )
      return
    }

    subscribedRooms.current.set(
      roomID,
      (subscribedRooms.current.get(roomID) ?? 1) - 1
    )

    if (subscribedRooms.current.get(roomID)! <= 0) {
      emitMessage({
        MessageType: "Unsubscribe",
        MessageID: generateID(),
        RoomID: roomID,
      } as Omit<UnsubscribeMessage, "MessageMS">)
    }
  }

  return (
    <Ctx.Provider
      value={{
        conn: conn.current,
        connectedRooms: subscribedRooms.current,
        subscribeToRoom,
        unsubFromRoom,
        emitSetState,
        emitCallFunction,
      }}
    >
      {props.children}
    </Ctx.Provider>
  )
}

const Ctx = createContext<FrontlinkState | null>(null)

type StateType<T> = T | ((v: T) => T)
type SetterFunction<T> = (value: T | StateType<T>) => void

export function useSharedState<T>(
  roomID: string,
  initialValue: T
): [T, SetterFunction<T>] {
  const ctx = useContext(Ctx)
  const [state, setState] = useState<T>(initialValue)

  // We're only going to actually update if the value has changed
  const setter = useCallback(
    (val: StateType<T>) => {
      setState(val)

      if (!ctx) {
        console.error("did not have context for shared state setter")
        return
      }

      ctx.emitSetState(roomID, val)
    },
    [state]
  )

  useEffect(() => {
    if (!ctx) {
      console.error("did not have context for shared state")
      return
    }

    ctx.subscribeToRoom(roomID)
    internalEmitter.on(roomID, setter)

    return () => {
      ctx.unsubFromRoom(roomID)
      internalEmitter.removeListener(roomID, setter)
    }
  }, [ctx])

  return [state, setter]
}

export function useSharedFunction<T extends any[]>(
  roomID: string,
  func: (...args: T) => void
) {
  const ctx = useContext(Ctx)

  const caller = (...args: T) => {
    if (!ctx) {
      console.error("did not have context for shared function caller")
      return
    }

    func(...args)
    ctx.emitCallFunction(
      roomID,
      args.map((arg) => JSON.stringify(arg))
    )
  }

  function callerWrapper(stringArgs: string[]) {
    const args: any = stringArgs.map((arg) => JSON.parse(arg))
    console.debug("calling function", roomID, "with args", args)
    caller(...args)
  }

  useEffect(() => {
    if (!ctx) {
      console.error("did not have context for shared function")
      return
    }

    ctx.subscribeToRoom(roomID)
    internalEmitter.on(roomID, callerWrapper)

    return () => {
      ctx.unsubFromRoom(roomID)
      internalEmitter.removeListener(roomID, callerWrapper)
    }
  }, [ctx])

  return caller
}
