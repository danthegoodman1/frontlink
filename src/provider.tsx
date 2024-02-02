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

import { v4 as uuid } from "uuid"

export type RoomKind = "State" | "Function"

interface FrontlinkState {
  conn: WebSocket | null
  subscribeToRoom(roomID: string, kind: RoomKind, initialValue?: any): void
  unsubFromRoom(roomID: string, kind: RoomKind): void
  emitSetState(stateID: string, value: any): void
  emitCallFunction(functionID: string, args: any[]): void
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

function randomID(): string {
  return uuid()
}

interface FrontlinkProviderProps extends PropsWithChildren {
  api: string
  /**
   * The maximum number of milliseconds that messages will be buffered locally
   * if the socket is not connected. Default 10_000
   */
  maxBufferMS?: number
  /**
   * When creating a new websocket connection, this will append the returned search params.
   * Useful for re-creating auth tokens during reconnects, or shortly delaying connect until auth token generated.
   */
  preConnect?: () => Promise<URLSearchParams>
  debugLog?: boolean
  /**
   * Default 5000. Set to 0 to disable.
   */
  pingIntervalMS?: number
  /**
   * Default 3000
   */
  reconnectDelayMS?: number
}

let printDebug = false

function debug(...args: any[]) {
  if (printDebug) {
    console.debug(...args)
  }
}

export function FrontlinkProvider(props: FrontlinkProviderProps) {
  const conn = useRef<WebSocket | null>(null)
  const connectedRooms = useRef<Set<string> | null>(null)
  const msgDedupe = useRef<Set<string> | null>(null)
  const pingTimeout = useRef<number | null>(null)

  printDebug = !!props.debugLog

  async function connectToWS() {
    // Kill the ping interval if it exists
    const url = new URL(props.api)
    if (props.preConnect) {
      const newParams = await props.preConnect()
      newParams.forEach((val, key) => {
        url.searchParams.append(key, val)
      })
      debug("using final url", url.toString())
    }
    conn.current = new WebSocket(url)
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

      debug("msg receieved", msg)

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

        case "RoommateSubscribed":
          Emitter.emit(EventType.RoommateSubscribed, {
            roomID: msg.RoomID,
            clientID: msg.ClientID,
          })
          break

        case "RoommateUnsubscribed":
          Emitter.emit(EventType.RoommateUnsubscribed, {
            roomID: msg.RoomID,
            clientID: msg.ClientID,
          })
          break

        default:
          break
      }
    }

    conn.current.onopen = (event) => {
      debug("websocket opened", event)
      Emitter.emit(EventType.SocketOpened, {
        event,
      })
    }

    conn.current.onclose = (event) => {
      debug("websocket closed", event)
      Emitter.emit(EventType.SocketClosed, {
        event,
      })

      // Reconnect
      setTimeout(() => {
        debug("reconnecting after close")
        connectToWS()
      }, props.reconnectDelayMS ?? 3000)
    }
    conn.current.onerror = (event) => {
      debug("websocket error", event)
      Emitter.emit(EventType.SocketError, {
        event,
      })
    }
  }

  if (conn.current === null) {
    connectToWS()
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

    msgDedupe.current.add(msg.MessageID)

    // Send to socket
    debug("emitting", msg, JSON.stringify(msg), conn.current?.readyState)
    if (conn.current?.readyState !== conn.current.OPEN) {
      // Buffer it up
      debug("socket not open, spinning")
      const started = new Date().getTime()
      const interval = setInterval(() => {
        if (new Date().getTime() > started + (props.maxBufferMS ?? 10_000)) {
          // Drop them
          clearInterval(interval)
          console.error(
            "frontlink did not connect to socket in time, dropping message"
          )
          // internal emit?
          return
        }

        if (conn.current?.readyState === conn.current?.OPEN) {
          debug("going")
          conn.current?.send(JSON.stringify(msg))
          Emitter.emit(EventType.MessageEmitted, {
            msg,
          })
          clearInterval(interval)
          return
        }

        debug("socket still not open...")
      }, 300)
    } else {
      conn.current.send(JSON.stringify(msg))
      Emitter.emit(EventType.MessageEmitted, {
        msg,
      })
    }
  }

  function emitSetState(roomID: string, val: any) {
    debug(roomID, val)
    emitMessage({
      RoomID: roomID,
      Value: val,
      MessageID: randomID(),
      MessageType: "StateUpdate",
    } as Omit<StateUpdateMessage, "MessageMS">)
  }

  function emitCallFunction(roomID: string, args: any[]) {
    emitMessage({
      RoomID: roomID,
      Args: args,
      MessageID: randomID(),
      MessageType: "CallFunction",
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
      MessageID: randomID(),
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
        MessageID: randomID(),
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

  function callerWrapper(args: any) {
    debug("calling function", uniqueFunctionID, "with args", args)
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
