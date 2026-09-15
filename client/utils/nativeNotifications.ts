import { LocalNotifications } from '@capacitor/local-notifications';

/**
 * Synthesizes a gentle modern audio chime for incoming notifications
 */
export function playNotificationChime() {
    try {
        if (typeof window === 'undefined') return;
        // Don't start AudioContext before the user has interacted with the document
        if (typeof navigator !== 'undefined' && (navigator as any).userActivation && !(navigator as any).userActivation.hasBeenActive) {
            return;
        }
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
            // Do not call resume without gesture
            return;
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880.00, ctx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
    } catch (e) {
        // AudioContext silent fallback
    }
}

/**
 * Request Mobile OS Native Push & Local Notification Permissions and create Android channels
 */
export async function requestMobileNotificationPermissions() {
    try {
        if (typeof window !== 'undefined') {
            // 1. Web / PWA Notification permission
            if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                await Notification.requestPermission();
            }

            // 2. Capacitor Android Native permission & channel setup
            try {
                const perm = await LocalNotifications.checkPermissions();
                if (perm.display !== 'granted') {
                    await LocalNotifications.requestPermissions();
                }

                // Create Android 8.0+ high-priority notification channel
                await LocalNotifications.createChannel({
                    id: 'school_notifications',
                    name: 'School Alerts & Notices',
                    description: 'Real-time operational school notifications',
                    importance: 5, // High importance (heads-up banner)
                    visibility: 1, // Public on lockscreen
                    vibration: true
                });
            } catch (capErr) {
                // Non-Capacitor / pure browser fallback
            }
        }
    } catch (err) {
        console.warn("Mobile notification permission request warning:", err);
    }
}

/**
 * Triggers a Mobile OS Native Device Notification on top of phone screen / status bar
 */
export async function triggerNativeDeviceNotification(id: number, title: string, message: string, link?: string) {
    try {
        if (typeof window === 'undefined') return;

        // Play audible chime
        playNotificationChime();

        let scheduledCapacitor = false;

        // A. Capacitor Android Native Device Notification
        try {
            await LocalNotifications.schedule({
                notifications: [
                    {
                        title: title,
                        body: message,
                        id: Math.floor(Math.abs(id)) || Math.floor(Math.random() * 100000),
                        schedule: { at: new Date(Date.now() + 200) },
                        channelId: 'school_notifications',
                        smallIcon: 'ic_stat_icon',
                        actionTypeId: '',
                        extra: { link: link || '/dashboard' }
                    }
                ]
            });
            scheduledCapacitor = true;
        } catch (capErr) {
            // Non-Capacitor environment
        }

        // B. Fallback to Browser / Web Notification API
        if (!scheduledCapacitor && 'Notification' in window && Notification.permission === 'granted') {
            const notif = new Notification(title, {
                body: message,
                icon: '/icon.png',
                badge: '/icon.png',
                tag: `notif-${id}`
            });
            if (link) {
                notif.onclick = () => {
                    window.focus();
                    window.location.href = link;
                };
            }
        }
    } catch (err) {
        console.warn("Native notification trigger error:", err);
    }
}

/**
 * Attaches a persistent listener for notification tap events to navigate to the target link
 */
export function setupNativeNotificationActionListener(onNavigate: (url: string) => void) {
    try {
        LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
            const targetLink = notificationAction?.notification?.extra?.link;
            if (targetLink && typeof onNavigate === 'function') {
                onNavigate(targetLink);
            }
        });
    } catch (e) {
        // Non-Capacitor environment
    }
}

