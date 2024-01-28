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
import * as EventType from "./events"

export type RoomKind = "State" | "Function"

interface FrontlinkState {
  conn: WebSocket
  subscribeToRoom(roomID: string, kind: RoomKind, initialValue?: any): void
  unsubFromRoom(roomID: string, kind: RoomKind): void
  emitSetState(stateID: string, value: any): void
  emitCallFunction(functionID: string, value: string[]): void
  /**
   * Number of dependent states or functions on a room
   */
  connectedRooms: Set<string>
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
    opts?: {
      /**
       * The maximum number of milliseconds that messages will be buffered locally
       * if the socket is not connected. Default 10_000
       */
      maxBufferMS?: number
    }
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
        console.error("Failed to parse", error)
        Emitter.emit(EventType.DeserializationError, {
          event,
        })
        return
      }

      console.debug("msg receieved", msg)

      if (msgDedupe.current!.has(msg.MessageID!)) {
        console.warn("duplicate message detected, dropping")
        Emitter.emit(EventType.DuplicateMessageReceived, {
          msg,
        })
        return
      }

      switch (msg.MessageType) {
        case "StateUpdate":
          internalEmitter.emit(
            stateUpdateInternalEmitterID(msg.RoomID),
            msg.Value
          )
          break
        case "CallFunction":
          internalEmitter.emit(
            callFunctionInternalEmitterID(msg.RoomID),
            msg.Args
          )
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

    // Send to socket
    console.debug("emitting", msg, conn.current.readyState)
    if (conn.current.readyState !== conn.current.OPEN) {
      // Buffer it up
      console.debug("socket not open, spinning")
      const started = new Date().getTime()
      const interval = setInterval(() => {
        if (
          new Date().getTime() >
          started + (props.opts?.maxBufferMS ?? 10_000)
        ) {
          // Drop them
          clearInterval(interval)
          console.error(
            "frontlink did not connect to socket in time, dropping message"
          )
          // internal emit?
          return
        }

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
      RoomID: roomID,
      Value: JSON.stringify(val),
    } as Omit<StateUpdateMessage, "MessageMS">)
  }

  function emitCallFunction(roomID: string, ...args: any[]) {
    emitMessage({
      RoomID: roomID,
      Args: args.map((arg) => JSON.stringify(arg)),
    } as Omit<CallFunctionMessage, "MessageMS">)
  }

  function subscribeToRoom(roomID: string, kind: RoomKind, initialValue?: any) {
    if (connectedRooms.current === null || conn.current === null) {
      return
    }

    if (connectedRooms.current.has(roomID)) {
      console.error(
        "tried to sub to room",
        roomID,
        "but a subscription already existed!"
      )
      Emitter.emit(EventType.RoomCollisionPrevented, {
        roomID,
      })
      return
    }

    emitMessage({
      MessageType: kind === "State" ? "SubscribeState" : "SubscribeFunction",
      RoomID: roomID,
      Value: initialValue,
    } as Omit<SubscribeMessage, "MessageMS">)
    connectedRooms.current.add(roomID)
    Emitter.emit(EventType.RoomSubscribed, {
      roomID,
    })
  }

  function unsubFromRoom(roomID: string, kind: RoomKind) {
    if (connectedRooms.current === null || conn.current === null) {
      return
    }

    if (!connectedRooms.current.has(roomID)) {
      console.error(
        "tried to unsub from room",
        roomID,
        "without any existing known connections. This is a bug, please report"
      )
      return
    } else {
      emitMessage({
        MessageType:
          kind === "State" ? "UnsubscribeState" : "UnsubscribeFunction",
        RoomID: roomID,
      } as Omit<UnsubscribeMessage, "MessageMS">)
      connectedRooms.current.delete(roomID)
      Emitter.emit(EventType.RoomUnsubscribed, {
        roomID,
      })
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

    ctx.subscribeToRoom(uniqueStateID, "State", initialValue)
    internalEmitter.on(internalEmitterID, setState)

    return () => {
      ctx.unsubFromRoom(uniqueStateID, "State")
      internalEmitter.removeListener(internalEmitterID, setState)
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

    ctx.emitCallFunction(uniqueFunctionID, args)
  }

  function callerWrapper(stringArgs: string[]) {
    const args: any = stringArgs.map((arg) => JSON.parse(arg))
    console.debug("calling function", uniqueFunctionID, "with args", args)
    func(...args)
  }

  useEffect(() => {
    if (!ctx) {
      console.error("did not have context for shared function")
      return
    }

    ctx.subscribeToRoom(uniqueFunctionID, "Function")
    internalEmitter.on(internalEmitterID, callerWrapper)

    return () => {
      ctx.unsubFromRoom(uniqueFunctionID, "Function")
      internalEmitter.removeListener(internalEmitterID, callerWrapper)
    }
  }, [ctx])

  return caller
}
