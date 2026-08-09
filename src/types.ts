export type QueueName = "add" | "remove";

export interface SeedEmails {
  add: string[];
  remove: string[];
}

export interface GroupRunResult {
  action: string;
  processed: number;
  successCount: number;
  failedCount: number;
  details: ActionDetail[];
  stdout: string;
  stderr: string;
}

export type ActionStatus = "ok" | "fail";

export interface ActionDetail {
  email: string;
  group: string;
  status: ActionStatus;
  message?: string;
}
