import { toast, ToastOptions } from 'react-toastify';

// Minor beep sound using AudioContext
const playMinorBeep = () => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = 880; // High pitch short beep
    
    gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime); // Volume
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
  } catch (error) {
    console.log('Error playing beep:', error);
  }
};

const defaultOptions: ToastOptions = {
  position: "top-right",
  autoClose: 3000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
  theme: "colored", // will match the color theme (success = green, error = red, info = blue)
};

export const showToast = {
  success: (message: string, options?: ToastOptions) => {
    playMinorBeep();
    toast.success(message, { ...defaultOptions, ...options });
  },
  error: (message: string, options?: ToastOptions) => {
    playMinorBeep();
    toast.error(message, { ...defaultOptions, ...options });
  },
  info: (message: string, options?: ToastOptions) => {
    playMinorBeep();
    toast.info(message, { ...defaultOptions, ...options });
  },
  warning: (message: string, options?: ToastOptions) => {
    playMinorBeep();
    toast.warning(message, { ...defaultOptions, ...options });
  },
};
