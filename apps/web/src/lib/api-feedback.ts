export type ApiActivityKind = "read" | "write";

export interface ApiActivity {
  id: string;
  kind: ApiActivityKind;
  scope: string;
  label: string;
  startedAt: number;
}

export interface Toast {
  id: string;
  kind: "success" | "error";
  message: string;
}

type Listener = () => void;

let activities: ApiActivity[] = [];
let toasts: Toast[] = [];
const activityListeners = new Set<Listener>();
const toastListeners = new Set<Listener>();

function notify(listeners: Set<Listener>): void {
  listeners.forEach((listener) => listener());
}

function id(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function subscribeApiActivity(listener: Listener): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function getApiActivities(): ApiActivity[] {
  return activities;
}

export function beginApiActivity(input: Omit<ApiActivity, "id" | "startedAt">): () => void {
  const activity: ApiActivity = { ...input, id: id(), startedAt: Date.now() };
  activities = [...activities, activity];
  notify(activityListeners);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    activities = activities.filter((item) => item.id !== activity.id);
    notify(activityListeners);
  };
}

export function subscribeToasts(listener: Listener): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

export function getToasts(): Toast[] {
  return toasts;
}

export function dismissToast(toastId: string): void {
  toasts = toasts.filter((toast) => toast.id !== toastId);
  notify(toastListeners);
}

export function pushToast(kind: Toast["kind"], message: string): void {
  const duplicate = toasts.find((toast) => toast.kind === kind && toast.message === message);
  if (duplicate) return;
  const toast = { id: id(), kind, message };
  toasts = [...toasts.slice(-2), toast];
  notify(toastListeners);
  if (kind === "success") {
    globalThis.setTimeout(() => dismissToast(toast.id), 3_000);
  }
}
