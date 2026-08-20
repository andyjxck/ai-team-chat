
"use client";

import { useEffect } from "react";
import { useNotification } from "@/hooks/use-notification";
import { AnimatePresence, motion } from "framer-motion";
import { XCircleIcon, CheckCircleIcon, InformationCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

export const Notification = () => {
  const { message, type, visible, hideNotification } = useNotification();

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        hideNotification();
      }, 3000); // Hide after 3 seconds
      return () => clearTimeout(timer);
    }
  }, [visible, hideNotification]);

  const getIcon = () => {
    switch (type) {
      case "success":
        return <CheckCircleIcon className="h-6 w-6 text-green-400" />;
      case "error":
        return <XCircleIcon className="h-6 w-6 text-red-400" />;
      case "warning":
        return <ExclamationTriangleIcon className="h-6 w-6 text-yellow-400" />;
      case "info":
      default:
        return <InformationCircleIcon className="h-6 w-6 text-blue-400" />;
    }
  };

  const getBackgroundColor = () => {
    switch (type) {
      case "success":
        return "bg-green-600";
      case "error":
        return "bg-red-600";
      case "warning":
        return "bg-yellow-600";
      case "info":
      default:
        return "bg-blue-600";
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className={
            "fixed bottom-4 left-1/2 -translate-x-1/2 p-4 rounded-lg shadow-lg text-white flex items-center space-x-3 z-50 " +
            getBackgroundColor()
          }
        >
          {getIcon()}
          <span>{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
