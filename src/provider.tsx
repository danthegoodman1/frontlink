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
  connectedRooms: Set<string>
}

function generateID(): string {
  // TODO: generate ID
  return ""
}

function stateUpdateInternalEmitterID(stateName: string): string {
  return "StateUpdate::" + stateName
}

function callFunctionInternalEmitterID(stateName: string): string {
  return "CallFunction::" + stateName
}

export const Emitter = new EventEmitter()
const internalEmitter = new EventEmitter()

export function FrontlinkProvider(
  props: PropsWithChildren<{
    api: string
  }>
) {
  const conn = useRef<WebSocket | null>(null)
  const connectedRooms = useRef<Set<string> | null>(null)
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

      switch (msg.MessageType) {
        case "StateUpdate":
          internalEmitter.emit(msg.RoomID)
          break

        default:
          break
      }
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

  if (connectedRooms.current === null) {
    connectedRooms.current = new Set<string>()
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
    console.debug("emitting", msg, conn.current.readyState)
    if (conn.current.readyState !== conn.current.OPEN) {
      // Buffer it up
      console.debug("socket not open, spinning")
      const interval = setInterval(() => {
        if (conn.current?.readyState === conn.current?.OPEN) {
          console.debug("going")
          conn.current?.send(JSON.stringify(msg))
          Emitter.emit(EventType.MessageEmitted, {
            msg,
          })
          clearInterval(interval)
          return
        }
        console.debug("socket still not open...")
      }, 300)
    } else {
      conn.current.send(JSON.stringify(msg))
      Emitter.emit(EventType.MessageEmitted, {
        msg,
      })
    }
  }

  function emitSetState(roomID: string, val: any) {
    console.debug(roomID, val)
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
    if (connectedRooms.current === null || conn.current === null) {
      return
    }

    if (connectedRooms.current.has(roomID)) {
      console.error(
        "tried to sub to room",
        roomID,
        "but a subscription already existed!"
      )
      // TODO: emit
      return
    }

    emitMessage({
      MessageType: "Subscribe",
      MessageID: generateID(),
      RoomID: roomID,
    } as Omit<SubscribeMessage, "MessageMS">)
    connectedRooms.current.add(roomID)
    // TODO: emit
  }

  function unsubFromRoom(roomID: string) {
    if (connectedRooms.current === null || conn.current === null) {
      return
    }

    if (!connectedRooms.current.has(roomID)) {
      console.warn(
        "tried to unsub from room",
        roomID,
        "without any existing known connections"
      )
      // TODO: emit
      return
    } else {
      emitMessage({
        MessageType: "Unsubscribe",
        MessageID: generateID(),
        RoomID: roomID,
      } as Omit<UnsubscribeMessage, "MessageMS">)
      connectedRooms.current.delete(roomID)
      // TODO: emit
    }
  }

  return (
    <Ctx.Provider
      value={{
        conn: conn.current,
        connectedRooms: connectedRooms.current,
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
  uniqueStateID: string,
  initialValue: T
): [T, SetterFunction<T>] {
  const internalEmitterID = stateUpdateInternalEmitterID(uniqueStateID)
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

      ctx.emitSetState(
        uniqueStateID,
        typeof val === "function" ? (val as Function)(state) : val
      )
    },
    [state]
  )

  useEffect(() => {
    if (!ctx) {
      console.error("did not have context for shared state")
      return
    }

    ctx.subscribeToRoom(uniqueStateID)
    internalEmitter.on(internalEmitterID, setter)

    return () => {
      ctx.unsubFromRoom(uniqueStateID)
      internalEmitter.removeListener(internalEmitterID, setter)
    }
  }, [ctx])

  return [state, setter]
}

export function useSharedFunction<T extends any[]>(
  uniqueFunctionID: string,
  func: (...args: T) => void
) {
  const internalEmitterID = callFunctionInternalEmitterID(uniqueFunctionID)
  const ctx = useContext(Ctx)

  const caller = (...args: T) => {
    func(...args)

    if (!ctx) {
      console.error("did not have context for shared function caller")
      return
    }

    ctx.emitCallFunction(
      uniqueFunctionID,
      args.map((arg) => JSON.stringify(arg))
    )
  }

  function callerWrapper(stringArgs: string[]) {
    const args: any = stringArgs.map((arg) => JSON.parse(arg))
    console.debug("calling function", uniqueFunctionID, "with args", args)
    caller(...args)
  }

  useEffect(() => {
    if (!ctx) {
      console.error("did not have context for shared function")
      return
    }

    ctx.subscribeToRoom(uniqueFunctionID)
    internalEmitter.on(internalEmitterID, callerWrapper)

    return () => {
      ctx.unsubFromRoom(uniqueFunctionID)
      internalEmitter.removeListener(internalEmitterID, callerWrapper)
    }
  }, [ctx])

  return caller
}