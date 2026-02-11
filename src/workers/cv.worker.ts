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
 * Region-based detection approach:
 * Instead of finding EDGES (Canny) which picks up internal card details,
 * find the bright CARD REGION against the darker background using thresholding.
 * The card appears as one solid bright blob → clean contour → check shape.
 */
function processFrame(imageData: ImageData) {
    if (!cv) return;
    frameCount++;

    try {
        const src = cv.matFromImageData(imageData);
        const totalArea = src.cols * src.rows;

        // === Strategy 1: Brightness-based (card is bright vs dark background) ===
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        // Bilateral filter: smooth internal texture but preserve card boundary edges
        const filtered = new cv.Mat();
        cv.bilateralFilter(gray, filtered, 9, 75, 75);

        // Otsu threshold: automatically separates bright card from dark background
        const binary = new cv.Mat();
        cv.threshold(filtered, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

        // Morphological close: fill tiny gaps inside the card region
        const closeKernel = cv.Mat.ones(15, 15, cv.CV_8U);
        cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, closeKernel);
        closeKernel.delete();

        // Find contours of bright regions
        const contours1 = new cv.MatVector();
        const hierarchy1 = new cv.Mat();
        cv.findContours(binary, contours1, hierarchy1, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // === Strategy 2: Edge-based (Canny + dilate, as fallback) ===
        const edges = new cv.Mat();
        cv.Canny(filtered, edges, 50, 150);
        const dilateKernel = cv.Mat.ones(7, 7, cv.CV_8U);
        cv.dilate(edges, edges, dilateKernel);
        dilateKernel.delete();

        const contours2 = new cv.MatVector();
        const hierarchy2 = new cv.Mat();
        cv.findContours(edges, contours2, hierarchy2, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // Merge candidates from both strategies
        const allContours: { cnt: any; area: number; source: string }[] = [];
        for (let i = 0; i < contours1.size(); i++) {
            const cnt = contours1.get(i);
            allContours.push({ cnt, area: cv.contourArea(cnt), source: 'thresh' });
        }
        for (let i = 0; i < contours2.size(); i++) {
            const cnt = contours2.get(i);
            allContours.push({ cnt, area: cv.contourArea(cnt), source: 'canny' });
        }

        // Sort by area descending, check top 15
        allContours.sort((a, b) => b.area - a.area);
        const toCheck = allContours.slice(0, 15);

        let bestScore = 0;
        let bestContour: any = null;
        let bestAR = 0;
        let bestRect: any = null;

        for (let i = 0; i < toCheck.length; i++) {
            const { cnt, area, source } = toCheck[i];

            // Area: 3-40% of frame
            if (area < totalArea * 0.03 || area > totalArea * 0.40) continue;

            // Use minAreaRect — works regardless of vertex count
            const rotatedRect = cv.minAreaRect(cnt);
            let w = rotatedRect.size.width;
            let h = rotatedRect.size.height;
            if (h > w) { const tmp = w; w = h; h = tmp; }

            const aspectRatio = w / h;

            // CR80 card AR = 1.585 → range 1.35-1.8 (handles perspective, rejects faces at ~1.25)
            if (aspectRatio < 1.35 || aspectRatio > 1.8) {
                if (frameCount % 15 === 0 && i < 3) {
                    console.log(`[CV]   #${i}(${source}): AR=${aspectRatio.toFixed(2)} SKIP, area=${(area / totalArea * 100).toFixed(1)}%`);
                }
                continue;
            }

            // Fill ratio: contour area vs rotated rect area
            // Cards fill ~0.85+ of their bounding rect, faces fill ~0.6-0.7
            const rectArea = w * h;
            const fillRatio = area / rectArea;
            if (fillRatio < 0.75) {
                if (frameCount % 15 === 0 && i < 5) {
                    console.log(`[CV]   #${i}(${source}): fill=${fillRatio.toFixed(2)} SKIP, AR=${aspectRatio.toFixed(2)}`);
                }
                continue;
            }

            // Edge-touching rejection (10px margin)
            const br = cv.boundingRect(cnt);
            if (br.x < 10 || br.y < 10 ||
                br.x + br.width > src.cols - 10 ||
                br.y + br.height > src.rows - 10) {
                continue;
            }

            // Score = area × fill (prefer larger, better-filled shapes)
            const score = area * fillRatio;

            if (frameCount % 15 === 0) {
                console.log(`[CV]   ✓ #${i}(${source}): AR=${aspectRatio.toFixed(2)}, fill=${fillRatio.toFixed(2)}, area=${(area / totalArea * 100).toFixed(1)}%`);
            }

            if (score > bestScore) {
                bestScore = score;
                bestContour = cnt;
                bestAR = aspectRatio;
                bestRect = br;
            }
        }

        if (frameCount % 15 === 0) {
            console.log(`[CV] Frame ${frameCount}: ${contours1.size()}+${contours2.size()} contours`);
        }

        const result: DetectionResult = {
            status: 'searching',
            documentType: 'Unknown',
            message: 'Looking for document...'
        };

        if (bestContour && bestRect) {
            result.status = 'detected';
            result.box = {
                x: bestRect.x, y: bestRect.y,
                width: bestRect.width, height: bestRect.height,
                corners: [
                    { x: bestRect.x, y: bestRect.y },
                    { x: bestRect.x + bestRect.width, y: bestRect.y },
                    { x: bestRect.x + bestRect.width, y: bestRect.y + bestRect.height },
                    { x: bestRect.x, y: bestRect.y + bestRect.height },
                ]
            };

            result.documentType = 'ID Card';
            console.log(`[CV] ✅ DETECTED: ID Card, AR=${bestAR.toFixed(2)}, area=${(bestScore / totalArea * 100).toFixed(1)}%, ${bestRect.width}x${bestRect.height}`);

            // Centering check
            const cx = bestRect.x + bestRect.width / 2;
            const cy = bestRect.y + bestRect.height / 2;
            const tol = src.cols * 0.18;

            if (Math.abs(cx - src.cols / 2) < tol && Math.abs(cy - src.rows / 2) < tol) {
                result.status = 'centered';
                result.message = 'Hold Still...';
                console.log(`[CV] 🎯 CENTERED`);
            } else {
                result.message = 'Center the document';
            }
        } else if (frameCount % 15 === 0) {
            console.log(`[CV] ❌ No card detected`);
        }

        self.postMessage({ type: 'DETECTION_RESULT', payload: result });

        // Cleanup
        src.delete(); gray.delete(); filtered.delete(); binary.delete();
        edges.delete();
        contours1.delete(); hierarchy1.delete();
        contours2.delete(); hierarchy2.delete();

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
