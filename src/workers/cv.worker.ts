/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

type DetectionResult = any;

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

/**
 * Strategy inspired by jscanify:
 *   Canny → blur → threshold → findContours → sort by area → pick largest 4-sided one
 * 
 * Added for handheld card detection:
 *   - Require approxPolyDP to give 4 vertices (it's a rectangle)
 *   - Require card-like aspect ratio (1.2-2.0 for CR80 landscape, or 0.5-0.85 for A4 portrait)
 *   - Minimum area 5% of frame (to skip tiny noise)
 *   - Skip contours that span the full frame (face/background)
 */
function processFrame(imageData: ImageData) {
    if (!cv) return;
    frameCount++;

    try {
        const src = cv.matFromImageData(imageData);
        const totalArea = src.cols * src.rows;

        // Step 1: Canny edge detection on the raw image (following jscanify approach)
        const edges = new cv.Mat();
        cv.Canny(src, edges, 50, 200);

        // Step 2: Gaussian blur on edges to connect nearby edge fragments
        const blurred = new cv.Mat();
        cv.GaussianBlur(edges, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

        // Step 3: Otsu threshold to get binary edge image
        const binary = new cv.Mat();
        cv.threshold(blurred, binary, 0, 255, cv.THRESH_OTSU);

        // Step 4: Dilate to close small gaps in edges
        const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
        cv.dilate(binary, binary, kernel);
        kernel.delete();

        // Step 5: Find contours
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(binary, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

        if (frameCount % 15 === 0) {
            console.log(`[CV] Frame ${frameCount}: ${contours.size()} contours found`);
        }

        // Step 6: Sort contours by area (descending) and find the largest quad
        let candidates: { contour: any; area: number; approx: any }[] = [];
        for (let i = 0; i < contours.size(); i++) {
            const cnt = contours.get(i);
            const area = cv.contourArea(cnt);
            candidates.push({ contour: cnt, area, approx: null });
        }
        candidates.sort((a, b) => b.area - a.area);

        // Only check top 20 largest contours (performance)
        const toCheck = candidates.slice(0, 20);

        let bestContour: any = null;
        let bestApprox: any = null;
        let bestArea = 0;
        let bestAR = 0;

        for (const cand of toCheck) {
            const { contour, area } = cand;

            // Skip too small (< 3% of frame) or too large (> 40% of frame)
            if (area < totalArea * 0.03 || area > totalArea * 0.40) continue;

            // Approximate polygon
            const peri = cv.arcLength(contour, true);
            const approx = new cv.Mat();
            cv.approxPolyDP(contour, approx, 0.04 * peri, true);

            // Log top-5 largest contours for diagnostics
            const idx = toCheck.indexOf(cand);
            if (frameCount % 15 === 0 && idx < 5) {
                console.log(`[CV]   #${idx}: v=${approx.rows}, area=${(area / totalArea * 100).toFixed(1)}%`);
            }

            // Must be a quadrilateral (exactly 4 vertices)
            if (approx.rows !== 4) {
                approx.delete();
                continue;
            }

            // Must be convex — real cards are convex rectangles
            if (!cv.isContourConvex(approx)) {
                approx.delete();
                continue;
            }

            // Bounding rect
            const rect = cv.boundingRect(approx);

            // Reject contours touching the frame edge (15px margin)
            const margin = 15;
            if (rect.x < margin || rect.y < margin ||
                rect.x + rect.width > src.cols - margin ||
                rect.y + rect.height > src.rows - margin) {
                approx.delete();
                continue;
            }

            // Fill ratio: contour area vs bounding rect area
            // A real card contour should fill most of its bounding rect
            const fillRatio = area / (rect.width * rect.height);
            if (fillRatio < 0.5) {
                approx.delete();
                continue;
            }

            const w = Math.max(rect.width, rect.height);
            const h = Math.min(rect.width, rect.height);
            const aspectRatio = w / h;

            // CR80 card AR = 1.585 → tight range 1.4-1.7
            if (aspectRatio < 1.4 || aspectRatio > 1.7) {
                if (frameCount % 15 === 0) {
                    console.log(`[CV]   Rejected: AR=${aspectRatio.toFixed(2)}, fill=${fillRatio.toFixed(2)}, area=${(area / totalArea * 100).toFixed(1)}%`);
                }
                approx.delete();
                continue;
            }

            if (frameCount % 15 === 0) {
                console.log(`[CV]   ✓ Quad found: AR=${aspectRatio.toFixed(2)}, area=${(area / totalArea * 100).toFixed(1)}%, ${rect.width}x${rect.height}`);
            }

            // Use the largest valid quad
            if (area > bestArea) {
                if (bestApprox) bestApprox.delete();
                bestContour = contour;
                bestApprox = approx;
                bestArea = area;
                bestAR = aspectRatio;
            } else {
                approx.delete();
            }
        }

        const result: DetectionResult = {
            status: 'searching',
            documentType: 'Unknown',
            message: 'Looking for document...'
        };

        if (bestContour && bestApprox) {
            result.status = 'detected';

            const rect = cv.boundingRect(bestApprox);
            result.box = {
                x: rect.x, y: rect.y,
                width: rect.width, height: rect.height,
                corners: [
                    { x: rect.x, y: rect.y },
                    { x: rect.x + rect.width, y: rect.y },
                    { x: rect.x + rect.width, y: rect.y + rect.height },
                    { x: rect.x, y: rect.y + rect.height },
                ]
            };

            // Classification
            if (bestAR >= 1.4 && bestAR <= 1.75) {
                result.documentType = 'ID Card'; // PAN / Aadhaar PVC / DL (all CR80)
            } else if (bestAR > 1.75) {
                result.documentType = 'ID Card'; // Slightly wider card
            } else {
                result.documentType = 'ID Card'; // Default to ID Card for any valid quad
            }

            console.log(`[CV] ✅ DETECTED: ${result.documentType}, AR=${bestAR.toFixed(2)}, area=${(bestArea / totalArea * 100).toFixed(1)}%, ${rect.width}x${rect.height}`);

            // Check centering
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;
            const tol = src.cols * 0.18;

            if (Math.abs(cx - src.cols / 2) < tol && Math.abs(cy - src.rows / 2) < tol) {
                result.status = 'centered';
                result.message = 'Hold Still...';
                console.log(`[CV] 🎯 CENTERED`);
            } else {
                result.message = 'Center the document';
            }

            bestApprox.delete();
        } else if (frameCount % 15 === 0) {
            console.log(`[CV] ❌ No card detected`);
        }

        self.postMessage({ type: 'DETECTION_RESULT', payload: result });

        // Cleanup
        src.delete();
        edges.delete();
        blurred.delete();
        binary.delete();
        contours.delete();
        hierarchy.delete();

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
