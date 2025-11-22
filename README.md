# Tobacco Price Monitor

This application monitors the Ministry of Finance Japan website for new tobacco retail price approval PDFs, converts them to text using OCR, and saves them locally.

## Prerequisites

1.  **Node.js**: Ensure Node.js is installed.
2.  **Poppler**: This app uses `pdftoppm` to convert PDFs to images for OCR.
    -   On macOS: `brew install poppler`
    -   On Ubuntu: `sudo apt-get install poppler-utils`

## Installation

1.  Navigate to the project directory:
    ```bash
    cd tobacco_price_monitor
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

## Usage

### 1. GitHub Actions (Recommended: Free & Serverless)
You can run this application automatically using GitHub Actions for free.

1.  Create a new repository on GitHub.
2.  Push this code to the repository:
    ```bash
    git init
    git add .
    git commit -m "Initial commit"
    git branch -M main
    git remote add origin <YOUR_GITHUB_REPO_URL>
    git push -u origin main
    ```
3.  That's it! The workflow defined in `.github/workflows/daily_monitor.yml` will:
    -   Run every day at 10:00 AM JST.
    -   Check for new PDFs.
    -   Convert them to text.
    -   **Commit and Push the new text files back to your repository automatically.**

### 2. Local Manual Execution
Run the application manually.

```bash
node index.js
```

### 3. Local Automatic Execution (Mac)
To have the application run automatically every day at 10:00 AM in the background on your Mac:

1.  Copy the provided plist file to your LaunchAgents directory:
    ```bash
    cp com.antigravity.tobaccoprice.plist ~/Library/LaunchAgents/
    ```
2.  Load the job:
    ```bash
    launchctl load ~/Library/LaunchAgents/com.antigravity.tobaccoprice.plist
    ```

## Note

-   The text extraction uses Tesseract.js (OCR) because the source PDFs often have custom encodings that prevent standard text extraction.
