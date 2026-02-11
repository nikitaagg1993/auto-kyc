/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

type DetectionResult = any;
type Point = any;

declare const self: DedicatedWorkerGlobalScope & { cv: any };

let cv: any = null;

function loadOpenCV(url: string) {
    try {
        self.importScripts(url);
        if (self.cv) {
            cv = self.cv;
            console.log("OpenCV loaded in worker");
            if (cv.getBuildInformation) {
                self.postMessage({ type: 'OPENCV_LOADED', payload: true });
            } else {
                cv['onRuntimeInitialized'] = () => {
                    console.log("OpenCV Runtime Initialized");
                    self.postMessage({ type: 'OPENCV_LOADED', payload: true });
                };
            }
        } else {
            throw new Error("cv not found in global scope");
        }
    } catch (e: any) {
        console.error("Failed to load OpenCV", e);
        self.postMessage({ type: 'ERROR', payload: e.message });
    }
}

let frameCount = 0;

function processFrame(imageData: ImageData) {
    if (!cv) return;
    frameCount++;

    try {
        const src = cv.matFromImageData(imageData);
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const thresh = new cv.Mat();
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();

        const totalArea = src.cols * src.rows;

        // 1. Preprocessing — use multiple approaches
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

        // Use adaptive threshold — works better for cards with varied backgrounds
        cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // Morphological close to merge nearby edges into solid regions
        const closeKernel = cv.Mat.ones(7, 7, cv.CV_8U);
        cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, closeKernel);
        closeKernel.delete();

        // Dilate to further solidify the card boundary
        const dilateKernel = cv.Mat.ones(3, 3, cv.CV_8U);
        cv.dilate(thresh, thresh, dilateKernel);
        dilateKernel.delete();

        // 2. Find Contours
        cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // Also try Canny as a fallback
        const edges = new cv.Mat();
        cv.Canny(blurred, edges, 50, 150);
        const edgeKernel = cv.Mat.ones(3, 3, cv.CV_8U);
        cv.dilate(edges, edges, edgeKernel);
        edgeKernel.delete();

        const contours2 = new cv.MatVector();
        const hierarchy2 = new cv.Mat();
        cv.findContours(edges, contours2, hierarchy2, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // Merge all candidate contours
        const allContours: any[] = [];
        for (let i = 0; i < contours.size(); i++) {
            allContours.push(contours.get(i));
        }
        for (let i = 0; i < contours2.size(); i++) {
            allContours.push(contours2.get(i));
        }

        if (frameCount % 10 === 0) {
            console.log(`[CV] Frame ${frameCount}: ${src.cols}x${src.rows}, candidates: ${allContours.length}`);
        }

        let bestScore = 0;
        let bestRect: any = null;
        let bestContour: any = null;

        // 3. For each contour, use minAreaRect to find the best rotated rectangle
        for (let i = 0; i < allContours.length; i++) {
            const cnt = allContours[i];
            const area = cv.contourArea(cnt);

            // Card should be 5-50% of the frame
            if (area < totalArea * 0.05 || area > totalArea * 0.50) continue;

            // Reject contours that touch the frame border (usually the frame edge itself)
            const br = cv.boundingRect(cnt);
            const margin = 5;
            if (br.x < margin || br.y < margin ||
                br.x + br.width > src.cols - margin ||
                br.y + br.height > src.rows - margin) continue;

            // Get the minimum area rotated rectangle
            const rotatedRect = cv.minAreaRect(cnt);
            let w = rotatedRect.size.width;
            let h = rotatedRect.size.height;

            // Ensure w > h for consistent aspect ratio
            if (h > w) { const tmp = w; w = h; h = tmp; }

            const aspectRatio = w / h;

            // Card-like aspect ratio: ID-1 cards are ~1.586
            // Allow range 1.3 to 1.85 for cards at angles
            if (aspectRatio < 1.3 || aspectRatio > 1.85) continue;

            // Fill ratio: how well does the contour fill its rotated rect?
            const rectArea = w * h;
            const fillRatio = area / rectArea;

            // For handheld cards, fill can be lower due to fingers — require > 0.4
            if (fillRatio < 0.4) continue;

            // Score: prefer larger area and better fill
            const score = area * fillRatio;

            if (frameCount % 10 === 0) {
                console.log(`[CV] Candidate: area=${Math.round(area)} (${(area / totalArea * 100).toFixed(1)}%), AR=${aspectRatio.toFixed(3)}, fill=${fillRatio.toFixed(2)}, score=${Math.round(score)}`);
            }

            if (score > bestScore) {
                bestScore = score;
                bestRect = {
                    x: Math.round(rotatedRect.center.x - w / 2),
                    y: Math.round(rotatedRect.center.y - h / 2),
                    width: Math.round(w),
                    height: Math.round(h),
                    angle: rotatedRect.angle
                };
                bestContour = cnt;
            }
        }

        const result: DetectionResult = {
            status: 'searching',
            documentType: 'Unknown',
            message: 'Looking for document...'
        };

        if (bestRect && bestContour) {
            result.status = 'detected';

            // Get standard bounding rect for overlay
            const boundRect = cv.boundingRect(bestContour);
            result.box = {
                x: boundRect.x,
                y: boundRect.y,
                width: boundRect.width,
                height: boundRect.height,
                corners: [
                    { x: boundRect.x, y: boundRect.y },
                    { x: boundRect.x + boundRect.width, y: boundRect.y },
                    { x: boundRect.x + boundRect.width, y: boundRect.y + boundRect.height },
                    { x: boundRect.x, y: boundRect.y + boundRect.height },
                ]
            };

            // Classification based on rotated rect aspect ratio
            const ar = bestRect.width / bestRect.height;

            // All Indian ID cards are ISO ID-1 size (~1.586 ratio)
            // We can't reliably distinguish PAN vs Aadhaar by shape alone
            // For now, label based on slight ratio differences
            if (ar > 1.5) {
                result.documentType = 'PAN / Aadhaar';
            } else {
                result.documentType = 'ID Card';
            }

            console.log(`[CV] ✅ DETECTED: type=${result.documentType}, AR=${ar.toFixed(3)}, area=${Math.round(bestScore)}, rect=${bestRect.width}x${bestRect.height}`);

            // Check if centered
            const centerX = boundRect.x + boundRect.width / 2;
            const centerY = boundRect.y + boundRect.height / 2;
            const imgCenterX = src.cols / 2;
            const imgCenterY = src.rows / 2;
            const tolerance = src.cols * 0.18;

            if (Math.abs(centerX - imgCenterX) < tolerance && Math.abs(centerY - imgCenterY) < tolerance) {
                result.status = 'centered';
                result.message = 'Hold Still...';
                console.log(`[CV] 🎯 CENTERED!`);
            } else {
                result.message = 'Center the document';
            }
        } else if (frameCount % 15 === 0) {
            console.log(`[CV] ❌ No card detected.`);
        }

        self.postMessage({ type: 'DETECTION_RESULT', payload: result });

        // Cleanup
        src.delete();
        gray.delete();
        blurred.delete();
        thresh.delete();
        edges.delete();
        contours.delete();
        hierarchy.delete();
        contours2.delete();
        hierarchy2.delete();

    } catch (e) {
        console.error("CV Processing Error", e);
    }
}

self.onmessage = (e) => {
    const { type, payload } = e.data;
    if (type === 'LOAD_OPENCV') {
        loadOpenCV(payload);
    } else if (type === 'PROCESS_FRAME') {
        processFrame(payload);
    }
};
