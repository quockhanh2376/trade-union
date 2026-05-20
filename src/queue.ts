import type { QueueName } from "./types";

export const state: Record<QueueName, string[]> = {
  add: [],
  remove: [],
};

export function ensureInQueue(target: QueueName, emails: string[]): void {
  const opposite: QueueName = target === "add" ? "remove" : "add";
  const nextTarget = new Set(state[target]);
  const nextOpposite = new Set(state[opposite]);
  emails.forEach((email) => {
    nextOpposite.delete(email);
    nextTarget.add(email);
  });
  state[target] = [...nextTarget].sort();
  state[opposite] = [...nextOpposite].sort();
}

export function removeFromQueue(target: QueueName, email: string): void {
  state[target] = state[target].filter((item) => item !== email);
}

export function moveEmail(email: string, source: QueueName, target: QueueName): void {
  if (source === target) return;
  removeFromQueue(source, email);
  ensureInQueue(target, [email]);
}
