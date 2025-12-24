# Yuusei Devtools

A mobile-friendly Chrome DevTools extension providing Network and Sources tabs with a customized UI.

## Features

*   **Network Tab**:
    *   Inspect network requests (Fetch, XHR, JS, CSS, Img, Media, etc.).
    *   View detailed Headers, Payload, Preview, Response, and Timing.
    *   Responsive layout optimized for mobile screens.
    *   Copy as cURL.
*   **Sources Tab**:
    *   View loaded resources in a file tree structure.
    *   Specific icons for JS and CSS files.
    *   Code viewer with vertical text wrapping (no horizontal scrolling).
*   **Mobile Optimized**:
    *   Full-screen vertical layout for code viewing.
    *   Touch-friendly tabs and file tree.

## Installation

1.  Download the source code.
2.  Open Chrome (or Kiwi Browser / Quetta Browser on Android).
3.  Go to `chrome://extensions`.
4.  Enable **Developer mode**.
5.  Click **Load unpacked** and select the extension directory.

## Usage

1.  Click the extension icon in the browser toolbar.
2.  Click "Open DevTools" in the popup.
3.  A new window/tab will open with the DevTools interface attached to the current tab.

## Note

This extension uses the `debugger` permission to access network and source information. It currently supports a subset of the full Chrome DevTools features, focused on inspection.
