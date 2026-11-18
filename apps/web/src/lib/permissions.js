export function can(featuresJson, feature) {
    if (!featuresJson)
        return false;
    if (feature === 'watermark') {
        return featuresJson.watermark === false;
    }
    return Boolean(featuresJson[feature]);
}
