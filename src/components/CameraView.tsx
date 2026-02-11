import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { useCamera } from '../hooks/useCamera';
import { useCardDetection } from '../hooks/useCardDetection';
import OverlayLayer from './OverlayLayer';
import ReviewScreen from './ReviewScreen';
import type { DocumentType } from '../types';

const CameraView: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const { stream, error } = useCamera();
    const { isCvLoaded, detectionResult } = useCardDetection({ videoRef, stream });

    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [finalDocType, setFinalDocType] = useState<DocumentType>('Unknown');
    const [isCapturing, setIsCapturing] = useState(false);

    // Auto-capture logic
    const stabilityCounter = useRef(0);
    const REQUIRED_STABLE_FRAMES = 10; // Approx 2 seconds at 5fps

    const captureImage = useCallback(() => {
        if (!videoRef.current) return;

        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0);
            const url = canvas.toDataURL('image/jpeg', 0.9);
            setCapturedImage(url);
            setFinalDocType(detectionResult?.documentType || 'Unknown');
            setIsCapturing(false);
        }
    }, [detectionResult]);

    useEffect(() => {
        if (detectionResult?.status === 'centered' && !capturedImage && !isCapturing) {
            stabilityCounter.current++;
            if (stabilityCounter.current > REQUIRED_STABLE_FRAMES) {
                setIsCapturing(true);
                captureImage();
            }
        } else {
            stabilityCounter.current = 0;
        }
    }, [detectionResult, capturedImage, isCapturing, captureImage]);

    // Attach stream to video element.
    // KEY FIX: Include isCvLoaded as a dependency so this effect re-runs
    // AFTER the loading screen is replaced by the <video> element.
    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch((e) => console.error('Video play error:', e));
        }
    }, [stream, isCvLoaded, capturedImage]);

    const handleRetake = () => {
        setCapturedImage(null);
        setFinalDocType('Unknown');
        setIsCapturing(false);
        stabilityCounter.current = 0;
    };

    const handleConfirm = () => {
        alert("Document Captured! (Integration end point)");
    };

    if (error) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'white', p: 2, textAlign: 'center' }}>
                <Typography variant="h6" color="error">{error}</Typography>
            </Box>
        );
    }

    // Review Mode
    if (capturedImage) {
        return (
            <ReviewScreen
                imageUrl={capturedImage}
                documentType={finalDocType}
                onRetake={handleRetake}
                onConfirm={handleConfirm}
            />
        );
    }

    // Loading state
    if (!stream || !isCvLoaded) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'white', bgcolor: 'black' }}>
                <CircularProgress color="primary" />
                <Typography variant="body1" sx={{ mt: 2 }}>
                    {!stream ? "Accessing Camera..." : "Loading Computer Vision..."}
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', bgcolor: 'black' }}>
            {/* Video Element */}
            <video
                ref={(el) => {
                    // Ref callback: attach stream as soon as the element mounts
                    (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
                    if (el && stream && !el.srcObject) {
                        el.srcObject = stream;
                        el.play().catch((e) => console.error('Video play error:', e));
                    }
                }}
                autoPlay
                playsInline
                muted
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                }}
            />

            {/* Logic & Overlay Layer */}
            <OverlayLayer detectionResult={detectionResult} />
        </Box>
    );
};

export default CameraView;
