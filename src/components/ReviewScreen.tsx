import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import type { DocumentType } from '../types';

interface ReviewScreenProps {
    imageUrl: string;
    documentType: DocumentType;
    onRetake: () => void;
    onConfirm: () => void;
}

const ReviewScreen: React.FC<ReviewScreenProps> = ({ imageUrl, documentType, onRetake, onConfirm }) => {
    return (
        <Box sx={{
            height: '100vh',
            bgcolor: '#121212',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            p: 3
        }}>
            <Paper elevation={3} sx={{
                p: 2,
                bgcolor: '#1e1e1e',
                borderRadius: 2,
                maxWidth: '500px',
                width: '100%',
                textAlign: 'center'
            }}>
                <Typography variant="h5" color="white" gutterBottom>
                    Review Capture
                </Typography>

                <Box sx={{
                    position: 'relative',
                    width: '100%',
                    aspectRatio: '1.586',
                    borderRadius: 2,
                    overflow: 'hidden',
                    my: 2,
                    border: '1px solid #333'
                }}>
                    <img src={imageUrl} alt="Captured Document" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </Box>

                <Typography variant="h6" color="primary" gutterBottom>
                    Detected: {documentType}
                </Typography>

                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 3 }}>
                    <Button variant="outlined" color="error" onClick={onRetake} fullWidth>
                        Retake
                    </Button>
                    <Button variant="contained" color="success" onClick={onConfirm} fullWidth>
                        Confirm
                    </Button>
                </Box>
            </Paper>
        </Box>
    );
};

export default ReviewScreen;
