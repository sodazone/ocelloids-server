import type { Header } from '@polkadot/types/interfaces';

import { QuerySubscription, XcmNotifyMessage, XcmReceived, XcmRelayed, XcmSent } from '../monitoring/types.js';
import { TypedEventEmitter } from '../types.js';

export type NotifyTelemetryMessage = {
  type: string,
  subscription: string,
  origin: string,
  destination: string,
  waypoint: string,
  outcome: string,
  channel: string,
  error?: string
}

export function notifyTelemetryFrom(
  type: string,
  channel: string,
  msg: XcmNotifyMessage,
  error?: string
) : NotifyTelemetryMessage {
  return {
    type,
    subscription: msg.subscriptionId,
    origin: msg.origin.chainId,
    destination: msg.destination.chainId,
    waypoint: msg.waypoint.chainId,
    outcome: msg.waypoint.outcome,
    channel,
    error
  };
}

export type TelemetryNotifierEvents = {
  telemetryNotify: (msg: NotifyTelemetryMessage) => void,
  telemetryNotifyError: (msg: NotifyTelemetryMessage) => void
};

export const TelemetryNotifierEventKeys: Array<keyof TelemetryNotifierEvents> = ['telemetryNotify', 'telemetryNotifyError'];

export type TelemetryEvents = {
  telemetryInbound: (message: XcmReceived) => void,
  telemetryOutbound: (message: XcmSent) => void,
  telemetryRelayed: (relayMsg: XcmRelayed) => void,
  telemetryMatched: (inMsg: XcmReceived, outMsg: XcmSent) => void,
  telemetryBlockSeen: (msg: {chainId: string, header: Header}) => void,
  telemetryBlockFinalized: (msg: {chainId: string, header: Header}) => void,
  telemetryBlockCacheHit: (msg: {chainId: string}) => void,
  telemetrySocketListener: (ip: string, sub: QuerySubscription, close?: boolean) => void,
  telemetrySubscriptionError: (msg: {subscriptionId: string, chainId: string, direction: 'in'|'out'|'relay'}) => void,
  telemetryHeadCatcherError: (msg: {chainId: string, method: string}) => void
} & TelemetryNotifierEvents;

export type TelemetryEventEmitter = TypedEventEmitter<TelemetryEvents>;