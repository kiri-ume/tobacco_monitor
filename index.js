const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Tesseract = require('tesseract.js');

const TARGET_URL = 'https://www.mof.go.jp/policy/tab_salt/topics/kouriteika.html';
const DATA_DIR = path.join(__dirname, 'data');
const PROCESSED_FILE = path.join(__dirname, 'processed_pdfs.json');
const TEMP_DIR = path.join(__dirname, 'temp');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// Load processed PDFs
let processedPdfs = [];
if (fs.existsSync(PROCESSED_FILE)) {
    try {
        processedPdfs = JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8'));
    } catch (err) {
        console.error('Error reading processed file:', err);
    }
}

async function saveProcessedList() {
    fs.writeFileSync(PROCESSED_FILE, JSON.stringify(processedPdfs, null, 2));
}

function convertPdfToImages(pdfPath, outputPrefix) {
    return new Promise((resolve, reject) => {
        // pdftoppm -png input.pdf output_prefix
        const pdftoppm = spawn('pdftoppm', ['-png', pdfPath, outputPrefix]);

        pdftoppm.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`pdftoppm exited with code ${code}`));
            } else {
                resolve();
            }
        });
    });
}

async function extractTextWithOcr(pdfBuffer) {
    const tempPdfPath = path.join(TEMP_DIR, `temp_${Date.now()}.pdf`);
    const tempImgPrefix = path.join(TEMP_DIR, `img_${Date.now()}`);

    fs.writeFileSync(tempPdfPath, pdfBuffer);

    try {
        await convertPdfToImages(tempPdfPath, tempImgPrefix);

        // Find generated images
        const files = fs.readdirSync(TEMP_DIR);
        const imageFiles = files.filter(f => f.startsWith(path.basename(tempImgPrefix)) && f.endsWith('.png'));
        imageFiles.sort(); // Ensure order

        let fullText = '';

        // Initialize worker once if possible, or create per file. Tesseract.js manages workers.
        const worker = await Tesseract.createWorker('jpn'); // Use Japanese language

        for (const imgFile of imageFiles) {
            const imgPath = path.join(TEMP_DIR, imgFile);
            console.log(`OCR processing: ${imgFile}`);
            const { data: { text } } = await worker.recognize(imgPath);
            fullText += text + '\n\n';

            // Clean up image
            fs.unlinkSync(imgPath);
        }

        await worker.terminate();

        return fullText;
    } finally {
        if (fs.existsSync(tempPdfPath)) {
            fs.unlinkSync(tempPdfPath);
        }
    }
}

const nodemailer = require('nodemailer');

// Email configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

async function sendEmail(processedItems) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.MAIL_TO) {
        console.log('Email configuration missing. Skipping email notification.');
        return;
    }

    const subject = `[Tobacco Monitor] ${processedItems.length} New PDF(s) Processed`;
    let text = `Found and processed ${processedItems.length} new PDF(s):\n\n`;

    processedItems.forEach(item => {
        text += `----------------------------------------\n`;
        text += `Title: ${item.title}\n`;
        text += `URL: ${item.url}\n`;
        text += `\n[Extracted Text]\n`;
        text += item.content.substring(0, 2000) + (item.content.length > 2000 ? '\n...(truncated)...' : ''); // Limit text length per item
        text += `\n\n`;
    });

    try {
        const info = await transporter.sendMail({
            from: `"Tobacco Price Monitor" <${process.env.SMTP_USER}>`,
            to: process.env.MAIL_TO,
            subject: subject,
            text: text,
        });
        console.log('Email sent: %s', info.messageId);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

async function processPdf(url, linkText) {
    try {
        console.log(`Processing: ${linkText} (${url})`);
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        const text = await extractTextWithOcr(buffer);

        // Create a filename based on the link text
        const sanitizedTitle = linkText.replace(/[\\/:*?"<>|]/g, '_').trim();
        const filename = `${sanitizedTitle}.txt`;
        const filePath = path.join(DATA_DIR, filename);

        fs.writeFileSync(filePath, text);
        console.log(`Saved text to: ${filePath}`);

        processedPdfs.push(url);
        await saveProcessedList();

        return { title: linkText, url: url, content: text };
    } catch (error) {
        console.error(`Error processing PDF ${url}:`, error.message);
        return null;
    }
}

async function checkAndProcess() {
    console.log('Checking for new PDFs...');
    try {
        const response = await axios.get(TARGET_URL);
        const $ = cheerio.load(response.data);
        const newLinks = [];

        $('a').each((i, elem) => {
            const href = $(elem).attr('href');
            const text = $(elem).text().trim();

            if (href && href.toLowerCase().endsWith('.pdf') && text.includes('製造たばこ小売定価')) {
                // Resolve relative URLs
                const fullUrl = href.startsWith('http') ? href : new URL(href, TARGET_URL).toString();

                if (!processedPdfs.includes(fullUrl)) {
                    newLinks.push({ url: fullUrl, text });
                }
            }
        });

        if (newLinks.length === 0) {
            console.log('No new PDFs found.');
        } else {
            console.log(`Found ${newLinks.length} new PDFs.`);

            const processedItems = [];
            // Process all new PDFs
            for (const link of newLinks) {
                const result = await processPdf(link.url, link.text);
                if (result) {
                    processedItems.push(result);
                }
            }

            if (processedItems.length > 0) {
                await sendEmail(processedItems);
            }
        }

    } catch (error) {
        console.error('Error fetching main page:', error.message);
    }
}

// Check if running in single-run mode (for system schedulers like launchd)
if (process.argv.includes('--once')) {
    console.log('Running in single-run mode...');
    checkAndProcess().then(() => {
        console.log('Single run completed.');
        process.exit(0);
    });
} else {
    // Schedule to run every day at 10:00 AM
    cron.schedule('0 10 * * *', () => {
        console.log('Running scheduled task...');
        checkAndProcess();
    });

    // Run immediately on start
    console.log('Starting Tobacco Price Monitor (OCR version)...');
    checkAndProcess();
}
