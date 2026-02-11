import { useState, useEffect, useRef } from 'react';
import type { DetectionResult, WorkerResponse } from '../types';

interface UseCardDetectionProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    stream: MediaStream | null;
}

export const useCardDetection = ({ videoRef, stream }: UseCardDetectionProps) => {
    const [isCvLoaded, setIsCvLoaded] = useState(false);
    const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const processingRef = useRef(false);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Initialize Worker
    useEffect(() => {
        // Vite in dev mode often forces module workers. 
        // To strictly use a Classic worker with importScripts, we can import the worker script as a raw URL 
        // and instantiate it manually, BUT cv.worker.ts is TypeScript.

        // Alternative: Use the constructed URL but ensure option { type: 'classic' } is passed.
        // Explicitly defining the worker options.

        const workerScriptUrl = new URL('../workers/cv.worker.ts', import.meta.url);
        workerRef.current = new Worker(workerScriptUrl, { type: 'classic' });

        workerRef.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const { type, payload } = event.data;

            if (type === 'OPENCV_LOADED') {
                setIsCvLoaded(true);
                console.log('OpenCV Loaded in Main Thread');
            } else if (type === 'DETECTION_RESULT') {
                setDetectionResult(payload);
                processingRef.current = false; // Ready for next frame
            } else if (type === 'ERROR') {
                console.error('Worker Error:', payload);
                processingRef.current = false;
            }
        };

        // Initialize OpenCV in worker
        workerRef.current.postMessage({ type: 'LOAD_OPENCV', payload: '/opencv.js' });

        return () => {
            workerRef.current?.terminate();
        };
    }, []);

    // Processing Loop
    useEffect(() => {
        if (!isCvLoaded || !stream || !videoRef.current) return;

        const processFrame = () => {
            if (processingRef.current) return; // Drop frame if busy
            if (!videoRef.current || videoRef.current.readyState !== 4) return;

            const video = videoRef.current;

            // Initialize canvas once
            if (!canvasRef.current) {
                canvasRef.current = document.createElement('canvas');
            }

            const canvas = canvasRef.current;
            // Downscale for processing speed
            const scale = 0.5;
            canvas.width = video.videoWidth * scale;
            canvas.height = video.videoHeight * scale;

            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                try {
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    processingRef.current = true;
                    // Send to worker
                    // We transfer the buffer to save copy time
                    workerRef.current?.postMessage({ type: 'PROCESS_FRAME', payload: imageData }, [imageData.data.buffer]);
                } catch (e) {
                    console.error("Frame read error", e);
                    processingRef.current = false;
                }
            }
        };

        const intervalId = setInterval(processFrame, 200); // 5 FPS

        return () => clearInterval(intervalId);
    }, [isCvLoaded, stream, videoRef]);

    return { isCvLoaded, detectionResult };
};
