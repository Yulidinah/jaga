import type { ServerResponse } from "node:http";
import { nowIso } from "./lib.js";
import type { Row, Session } from "./types.js";

export type EventType =
  | "connected"
  | "sos.created"
  | "incident.updated"
  | "incident.closed"
  | "alert.created"
  | "alert.receipt"
  | "resident.created"
  | "resident.updated"
  | "device.updated"
  | "team.updated"
  | "team.position"
  | "assignment.created"
  | "recommendation.updated"
  | "rule_set.published"
  | "hazard.updated"
  | "notification.created";

interface Subscriber {
  res: ServerResponse;
  villageIds: string[] | null;
  role: string;
  identity: string;
}

const subscribers = new Set<Subscriber>();
let beat: NodeJS.Timeout | null = null;

const allowed = (subscriber: Subscriber, villageId: unknown): boolean => {
  if (subscriber.role === "PUSAT" || subscriber.villageIds === null) return true;
  if (!villageId) return true;
  return subscriber.villageIds.includes(String(villageId));
};

export function addSubscriber(res: ServerResponse, session: Session): () => void {
  const subscriber: Subscriber = {
    res,
    villageIds: session.villageIds,
    role: session.role,
    identity: session.profileId
  };
  subscribers.add(subscriber);
  if (!beat) {
    beat = setInterval(() => {
      for (const item of subscribers) item.res.write(`: ping ${Date.now()}\n\n`);
    }, 25_000);
    beat.unref?.();
  }
  return () => { subscribers.delete(subscriber); };
}

export function publish(type: EventType, payload: Row, villageId?: unknown): void {
  if (!subscribers.size) return;
  const message = `event: ${type}\ndata: ${JSON.stringify({ ...payload, at: nowIso() })}\n\n`;
  for (const subscriber of subscribers) {
    if (!allowed(subscriber, villageId ?? payload.village_id)) continue;
    try {
      subscriber.res.write(message);
    } catch {
      subscribers.delete(subscriber);
    }
  }
}

export const subscriberCount = () => subscribers.size;
