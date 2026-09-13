/**
 * Utility function to compute similarity between two biometric feature vectors (descriptors).
 * Supports Face-API 128D float vectors, retina embeddings, and fingerprint feature arrays.
 * 
 * @param {Array<number>} vecA - First descriptor array
 * @param {Array<number>} vecB - Second descriptor array
 * @returns {number} Similarity score normalized between 0.0 (no match) and 1.0 (100% exact match)
 */
function computeBiometricSimilarity(vecA, vecB) {
    if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0) {
        return 0;
    }

    const len = Math.min(vecA.length, vecB.length);
    if (len === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    let sumSqDiff = 0;

    for (let i = 0; i < len; i++) {
        const a = Number(vecA[i]) || 0;
        const b = Number(vecB[i]) || 0;

        dotProduct += a * b;
        normA += a * a;
        normB += b * b;

        const diff = a - b;
        sumSqDiff += diff * diff;
    }

    const magA = Math.sqrt(normA);
    const magB = Math.sqrt(normB);

    if (magA === 0 || magB === 0) {
        return 0;
    }

    // Cosine similarity
    const cosineSim = dotProduct / (magA * magB);

    // Euclidean distance
    const euclideanDist = Math.sqrt(sumSqDiff);
    // Normalized Euclidean similarity
    const euclideanSim = Math.max(0, 1 - euclideanDist);

    // Use higher precision metric bounded between 0.0 and 1.0
    const similarity = Math.max(0, Math.min(1, Math.max(cosineSim, euclideanSim)));

    return similarity;
}

module.exports = {
    computeBiometricSimilarity
};
