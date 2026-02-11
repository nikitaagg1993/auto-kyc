import { useState, useEffect, useCallback } from 'react';

interface UseCameraResult {
    stream: MediaStream | null;
    error: string | null;
    permissionStatus: PermissionState | 'unknown';
}

export const useCamera = (): UseCameraResult => {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [permissionStatus, setPermissionStatus] = useState<PermissionState | 'unknown'>('unknown');

    const startCamera = useCallback(async () => {
        try {
            const constraints = {
                video: {
                    facingMode: 'environment', // Use rear camera on mobile
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            };

            const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            setStream(mediaStream);
            setPermissionStatus('granted');
            setError(null);
        } catch (err: any) {
            console.error('Error accessing camera:', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                setPermissionStatus('denied');
                setError('Camera permission denied. Please allow access to use the scanner.');
            } else {
                setError('Could not access camera. Ensure you are on HTTPS or localhost.');
            }
        }
    }, []);

    useEffect(() => {
        startCamera();

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, []); // Run once on mount

    return { stream, error, permissionStatus };
};
