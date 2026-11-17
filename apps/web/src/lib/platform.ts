/** True inside the Android app (it adds "SuperDriveAndroid/<version>" to its user agent). */
export const isAndroidApp = () => typeof navigator !== "undefined" && /SuperDriveAndroid\//.test(navigator.userAgent);
