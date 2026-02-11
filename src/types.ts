export interface Point {
    x: number;
    y: number;
}

export type DocumentType = 'ID Card' | 'Aadhaar Letter' | 'Passport' | 'Aadhaar' | 'PAN' | 'Driving License' | 'Unknown';

export interface DetectionResult {
    status: 'searching' | 'detected' | 'centered';
    documentType: DocumentType;
    box?: {
        x: number;
        y: number;
        width: number;
        height: number;
        corners?: Point[]; // TopLeft, TopRight, BottomRight, BottomLeft
    };
    message?: string;
}

export interface WorkerMessage {
    type: 'LOAD_OPENCV' | 'PROCESS_FRAME';
    payload?: any;
}

export interface WorkerResponse {
    type: 'OPENCV_LOADED' | 'DETECTION_RESULT' | 'ERROR';
    payload?: any;
}
