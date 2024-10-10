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
  connectedRooms: Map<string, RoomKind>
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
  /**
   * How often the dedupe set should be truncated. Default 30_000
   */
  dedupeTruncateIntervalMS?: number
}

let printDebug = false

function debug(...args: any[]) {
  if (printDebug) {
    console.debug(...args)
  }
}

export function FrontlinkProvider(props: FrontlinkProviderProps) {
  const conn = useRef<WebSocket | null>(null)
  const connectedRooms = useRef<Map<string, RoomKind>>(
    new Map<string, RoomKind>()
  )
  const msgDedupe = useRef<Set<string>>(new Set<string>())


  // closes an obsolete connection without triggering a reconnect
  function closeCurrentConnection() {
    if (conn.current) {
      conn.current.onclose = null;
      conn.current.onerror = null;
      conn.current.onmessage = null;
      conn.current.close();
      conn.current = null;
    }
  }

  // Close connection on unmount
  useEffect(() => {
    if (
      conn.current === null ||
      conn.current.readyState === conn.current.CLOSING ||
      conn.current.readyState === conn.current.CLOSED
    ) {
      connectToWS()
    }

    return () => {
      closeCurrentConnection()
    }
  }, [conn])

  setInterval(() => {
    debug("truncating dedupe set")
    msgDedupe.current = new Set<string>()
  }, props.dedupeTruncateIntervalMS ?? 30_000)

  printDebug = !!props.debugLog

  async function connectToWS() {
    closeCurrentConnection()

    const url = new URL(props.api)
    if (props.preConnect) {
      const newParams = await props.preConnect()
      newParams.forEach((val, key) => {
        url.searchParams.append(key, val)
      })
      debug("using final url", url.toString())
    }
    conn.current = new WebSocket(url)

    conn.current.onopen = (event) => {
      debug("websocket opened", event)

      // Emit sub to any room that we know about
      connectedRooms.current?.forEach((roomKind, roomID) => {
        debug("subscribing to room on open")
        emitMessage({
          MessageType:
            roomKind === "State" ? "SubscribeState" : "SubscribeFunction",
          RoomID: roomID,
          Value: undefined, // we don't know
          MessageID: randomID(),
        } as Omit<SubscribeMessage, "MessageMS">)
      })

      Emitter.emit(EventType.SocketOpened, {
        event,
      })
    }

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

      Emitter.emit(EventType.MessageReceived, {
        msg,
      })

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
    if (connectedRooms.current === null) {
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

    connectedRooms.current.set(roomID, kind)
    if (conn.current?.readyState === conn.current?.OPEN) {
      // Send if connected, otherwise open will handle
      debug("subscribing to room on demand")
      emitMessage({
        MessageType: kind === "State" ? "SubscribeState" : "SubscribeFunction",
        RoomID: roomID,
        Value: initialValue,
        MessageID: randomID(),
      } as Omit<SubscribeMessage, "MessageMS">)
    }
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
      connectedRooms.current.delete(roomID)
      if (conn.current?.readyState === conn.current.OPEN) {
        // Send if connected, otherwise open will handle
        debug("unsubscribing from room on demand")
        emitMessage({
          MessageType:
            kind === "State" ? "UnsubscribeState" : "UnsubscribeFunction",
          RoomID: roomID,
          MessageID: randomID(),
        } as Omit<UnsubscribeMessage, "MessageMS">)
      }
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
type SetterFunction<T> = {
  (value: T | StateType<T>): void

  noEmit(value: T | StateType<T>): void
}

export function useSharedState<T>(
  uniqueStateID: string | undefined | null,
  initialValue: T
): [T, SetterFunction<T>] {
  const internalEmitterID = stateUpdateInternalEmitterID(uniqueStateID ?? "")
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
      if (uniqueStateID === null || uniqueStateID === undefined) return

      ctx.emitSetState(
        uniqueStateID,
        typeof val === "function" ? (val as Function)(state) : val
      )
    },
    [state]
  ) as SetterFunction<T>
  /**
   * A special version of the function that executes without updating peers.
   * Useful if you need to update state based on something local
   * that doesn't make sense for roommates.
   */
  setter.noEmit = setState

  useEffect(() => {
    if (!ctx) {
      console.error("did not have context for shared state")
      return
    }

    if (uniqueStateID === null || uniqueStateID === undefined) {
      console.warn("no provided unique state id, ignoring")
      return
    }

    ctx.subscribeToRoom(uniqueStateID, "State", initialValue)
    internalEmitter.on(internalEmitterID, setState)

    return () => {
      ctx.unsubFromRoom(uniqueStateID, "State")
      internalEmitter.removeListener(internalEmitterID, setState)
    }
  }, [ctx, uniqueStateID])

  return [state, setter]
}

export function useSharedFunction<T extends any[]>(
  uniqueFunctionID: string | undefined | null,
  func: (...args: T) => void
) {
  const internalEmitterID = callFunctionInternalEmitterID(
    uniqueFunctionID ?? ""
  )
  const ctx = useContext(Ctx)

  const caller = (...args: T) => {
    func(...args)

    if (!ctx) {
      console.error("did not have context for shared function caller")
      return
    }
    if (uniqueFunctionID === null || uniqueFunctionID === undefined) return

    ctx.emitCallFunction(uniqueFunctionID, args)
  }
  /**
   * A special version of the function that executes without updating peers.
   * Useful if you need to use the function to poll and revalidate from peer updates.
   */
  caller.noEmit = func

  function callerWrapper(args: any) {
    debug("calling function", uniqueFunctionID, "with args", args)
    func(...args)
  }

  useEffect(() => {
    if (!ctx) {
      console.error("did not have context for shared function")
      return
    }

    if (uniqueFunctionID === null || uniqueFunctionID === undefined) {
      console.warn("no provided unique function id, ignoring")
      return
    }

    ctx.subscribeToRoom(uniqueFunctionID, "Function")
    internalEmitter.on(internalEmitterID, callerWrapper)

    return () => {
      ctx.unsubFromRoom(uniqueFunctionID, "Function")
      internalEmitter.removeListener(internalEmitterID, callerWrapper)
    }
  }, [ctx, uniqueFunctionID])

  return caller
}
