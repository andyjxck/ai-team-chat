
import { create } from "zustand";

type NotificationType = "success" | "error" | "info" | "warning";

interface NotificationState {
  message: string;
  type: NotificationType;
  visible: boolean;
  showNotification: (message: string, type?: NotificationType) => void;
  hideNotification: () => void;
}

export const useNotification = create<NotificationState>((set) => ({
  message: "",
  type: "info",
  visible: false,
  showNotification: (message, type = "info") =>
    set({ message, type, visible: true }),
  hideNotification: () => set({ visible: false }),
}));
