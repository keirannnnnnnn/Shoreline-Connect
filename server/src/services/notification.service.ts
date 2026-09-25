import EventEmitter from 'events';

export interface UpdateNotificationEvent {
  type: 'job_failed' | 'job_timed_out' | 'updates_available' | 'succeeded_not_detected';
  deviceId?: string;
  deviceName?: string;
  jobId?: string;
  jobType?: string;
  details: any;
  timestamp: string;
}

class NotificationEmitter extends EventEmitter {}

export const NotificationEvents = new NotificationEmitter();

export class NotificationService {
  /**
   * Dispatch an update / monitoring notification event to registered listeners
   */
  static notify(event: UpdateNotificationEvent): void {
    try {
      console.log(`[NotificationService] Event [${event.type}] for device [${event.deviceName || event.deviceId || 'N/A'}]:`, event.details);
      NotificationEvents.emit(event.type, event);
      NotificationEvents.emit('*', event);
    } catch (err: any) {
      console.error('[NotificationService] Failed to dispatch notification event:', err.message);
    }
  }
}
