import React from 'react';
import { Box, Typography } from '@mui/material';
import type { DetectionResult } from '../types';

interface OverlayLayerProps {
    detectionResult: DetectionResult | null;
    videoWidth?: number;
    videoHeight?: number;
}

const OverlayLayer: React.FC<OverlayLayerProps> = ({ detectionResult }) => {
    // Determine guide orientation based on detected document type
    const isA4Document = detectionResult?.documentType === 'Aadhaar Letter' ||
        detectionResult?.documentType === 'Passport';

    // Styles for the card guide
    const guideStyle = {
        position: 'absolute' as 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: isA4Document ? '85%' : '95%', // Wider guide boxes
        maxWidth: isA4Document ? '600px' : '800px',
        aspectRatio: isA4Document ? '0.707' : '1.586', // A4 portrait or CR80 landscape
        border: '2px dashed rgba(255, 255, 255, 0.5)',
        borderRadius: '12px',
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)', // Dim background
        pointerEvents: 'none' as 'none',
        zIndex: 10,
    };

    // Border color based on status
    let borderColor = 'rgba(255, 255, 255, 0.5)';
    let message = "Align card within frame";

    if (detectionResult) {
        if (detectionResult.status === 'detected') {
            borderColor = 'yellow';
            message = "Scanning...";
        } else if (detectionResult.status === 'centered') {
            borderColor = '#00ff00';
            message = "Hold Still - Capturing...";
        }
    }

    return (
        <Box sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10, pointerEvents: 'none' }}>

            {/* Static Guide Mask */}
            <div style={{ ...guideStyle, border: `3px solid ${borderColor}` }}>
                {/* Corner markers could go here */}
            </div>

            {/* Dynamic Bounding Box (Optional - if we want to show exact detection box) */}
            {/* For now, just using the static guide changing color is better UX for "centering" */}

            {/* Status Message */}
            <Box sx={{
                position: 'absolute',
                bottom: '15%',
                left: 0,
                width: '100%',
                textAlign: 'center',
                zIndex: 20
            }}>
                <Typography variant="h5" sx={{
                    color: 'white',
                    textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                    fontWeight: 'bold',
                    backgroundColor: 'rgba(0,0,0,0.3)',
                    display: 'inline-block',
                    px: 2,
                    py: 1,
                    borderRadius: 2
                }}>
                    {detectionResult?.message || message}
                </Typography>
                {detectionResult?.documentType && detectionResult.documentType !== 'Unknown' && (
                    <Typography variant="subtitle1" sx={{ color: '#aaa', mt: 1 }}>
                        Detected: {detectionResult.documentType}
                    </Typography>
                )}
            </Box>
        </Box>
    );
};

export default OverlayLayer;
