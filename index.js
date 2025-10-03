const TelegramBot = require('node-telegram-bot-api');
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

// --- ⚠️ CONFIGURATION ---
// Replace with your actual keys and tokens
const TELEGRAM_BOT_TOKEN = "8423743425:AAGpGxvN3sWZ3-CGlmZVI4kTvfMFEKE016g";
const VEO_API_KEY = "sk-paxsenix-_i4gxqZtBsLskDInu2RZXHmHuQJpjKSemVBzJsc47X_Hu23w"; // The key starting with sk-paxsenix...
const IMGBB_API_KEY = "1b4d99fa0c3195efe42ceb62670f2a25"; // Your imgbb.com API key

// --- API and Model Constants ---
const VEO_API_URL = "https://api.paxsenix.org/ai-video/veo-3";
const VALID_RATIOS = ["16:9", "9:16"];
const VALID_MODELS = ["veo-3", "veo-3-fast"];

// --- Bot Initialization ---
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
console.log("🤖 Veo AI Telegram Bot has started...");

// --- Temporary Directory Setup ---
const TEMP_DIR = path.join(__dirname, "tmp");
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// --- Localization (Language Strings) ---
const langs = {
    en: {
        startMessage: "👋 Welcome to the Veo AI Bot!\n\nTo generate a video, use the /veo command.\n\nExamples:\n1. `/veo a cinematic shot of a futuristic city`\n2. `/veo a cat playing piano --ar 16:9`\n3. `/veo a running dog veo-3-fast`\n\nYou can also reply to an image with the command to convert it into a video.",
        noPrompt: "Please provide a text prompt or reply to an image with the command.\nExample: `/veo a beautiful sunset`",
        invalidRatio: "Invalid aspect ratio. Available options are: %1",
        invalidModel: "Invalid model. Available models are: %1",
        noImage: "The replied message must contain a valid image.",
        uploadFailed: "Failed to upload the replied image for processing.",
        processFailed: "Failed to process the replied image. Please try another one.",
        noPromptWithImage: "A text prompt is required when converting an image to video.",
        sending: "⏳ Sending request... Please wait. This can take up to 5 minutes.",
        apiFailed: "❌ The API failed to return job information. Please try again later.",
        requestSent: "✅ Request sent successfully!\n\nJob ID: %1\n\nNow polling for results...",
        noResults: "❌ No results were returned within the time limit.",
        noVideo: "❌ No video file was found in the API response.",
        downloadFailed: "❌ Failed to download or send the generated video.",
        error: "❌ An unexpected error occurred. Please try again later."
    }
};

const getLang = (key, ...args) => {
    let text = langs.en[key] || "Language string not found.";
    args.forEach((arg, index) => {
        text = text.replace(`%${index + 1}`, arg);
    });
    return text;
};

// --- Helper Functions ---

async function downloadFile(url, dest) {
    const writer = fs.createWriteStream(dest);
    const response = await axios.get(url, { responseType: "stream" });
    return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
    });
}

async function uploadToImgbb(filePath) {
    try {
        const form = new FormData();
        form.append("image", fs.createReadStream(filePath));
        const res = await axios.post("https://api.imgbb.com/1/upload", form, {
            headers: form.getHeaders(),
            params: { key: IMGBB_API_KEY }
        });
        return res.data?.data?.url || null;
    } catch (error) {
        console.error("ImgBB Upload Error:", error.response ? error.response.data : error.message);
        return null;
    }
}

function extractMp4Urls(obj) {
    let urls = [];
    function search(value) {
        if (!value) return;
        if (typeof value === "string" && value.toLowerCase().endsWith(".mp4")) {
            urls.push(value);
        } else if (Array.isArray(value)) {
            value.forEach(search);
        } else if (typeof value === 'object') {
            for (const k in value) search(value[k]);
        }
    }
    search(obj);
    return [...new Set(urls)]; // Return unique URLs
}


// --- Bot Command Handlers ---

bot.onText(/^\/start$/, (msg) => {
    bot.sendMessage(msg.chat.id, getLang("startMessage"));
});

bot.onText(/^\/veo(?: (.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userInput = match[1] || "";
    const { reply_to_message } = msg;

    if (!userInput && !reply_to_message) {
        return bot.sendMessage(chatId, getLang("noPrompt"));
    }

    // --- Argument Parsing Logic ---
    let prompt, ratio, model;
    const args = userInput.split(/\s+/).filter(Boolean);
    const ratioIndex = args.findIndex(a => a.toLowerCase() === "--ar");

    if (ratioIndex !== -1) {
        ratio = args[ratioIndex + 1];
        if (!ratio || !VALID_RATIOS.includes(ratio)) {
            return bot.sendMessage(chatId, getLang("invalidRatio", VALID_RATIOS.join(", ")));
        }
        
        args.splice(ratioIndex, 2); // Remove --ar and its value
    } else {
        ratio = "9:16"; // Default ratio
    }

    const potentialModel = args[args.length - 1];
    if (VALID_MODELS.includes(potentialModel)) {
        model = potentialModel;
        args.pop(); // Remove model from args
    } else {
        model = "veo-3"; // Default model
    }
    
    prompt = args.join(" ").trim();
    // --- End of Argument Parsing ---

    let imageUrls = [];
    if (reply_to_message && reply_to_message.photo) {
        if (!prompt) {
             return bot.sendMessage(chatId, getLang("noPromptWithImage"));
        }
        
        const photo = reply_to_message.photo[reply_to_message.photo.length - 1]; // Get highest resolution
        const fileLink = await bot.getFileLink(photo.file_id);
        const filePath = path.join(TEMP_DIR, `tg_img_${Date.now()}.jpg`);
        
        try {
            await downloadFile(fileLink, filePath);
            const uploadedUrl = await uploadToImgbb(filePath);
            if (!uploadedUrl) {
                return bot.sendMessage(chatId, getLang("uploadFailed"));
            }
            imageUrls.push(uploadedUrl);
        } catch (err) {
            console.error(err);
            return bot.sendMessage(chatId, getLang("processFailed"));
        } finally {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    } else if (!prompt) {
        return bot.sendMessage(chatId, getLang("noPrompt"));
    }

    const type = imageUrls.length ? "image-to-video" : "text-to-video";
    const waitingMsg = await bot.sendMessage(chatId, getLang("sending"), { reply_to_message_id: msg.message_id });

    try {
        const params = { prompt, ratio, model, type };
        if (imageUrls.length) params.imageUrls = imageUrls.join(",");

        const res = await axios.get(VEO_API_URL, {
            headers: { Authorization: `Bearer ${VEO_API_KEY}` },
            params
        });

        const jobId = res.data?.jobId || res.data?.job_id;
        const taskUrl = res.data?.task_url || res.data?.taskUrl || res.data?.task;

        if (!jobId || !taskUrl) {
            return bot.editMessageText(getLang("apiFailed"), { chat_id: chatId, message_id: waitingMsg.message_id });
        }

        await bot.editMessageText(getLang("requestSent", jobId), { chat_id: chatId, message_id: waitingMsg.message_id });

        // --- Polling for results ---
        let taskData = null;
        const maxWaitSeconds = 600;
        const checkIntervalSeconds = 5;
        for (let i = 0; i < maxWaitSeconds / checkIntervalSeconds; i++) {
            await new Promise(r => setTimeout(r, checkIntervalSeconds * 1000));
            try {
                const tRes = await axios.get(taskUrl, { headers: { Authorization: `Bearer ${VEO_API_KEY}` } });
                const data = tRes.data;
                if (data && (data.status === "done" || data.status === "success" || data.url || data.data)) {
                    taskData = data;
                    break;
                }
            } catch (pollError) {
                console.error("Polling error, continuing...", pollError.message);
            }
        }

        if (!taskData) {
            return bot.editMessageText(getLang("noResults"), { chat_id: chatId, message_id: waitingMsg.message_id });
        }
        
        await bot.deleteMessage(chatId, waitingMsg.message_id);

        const mp4Urls = extractMp4Urls(taskData);
        if (taskData.url?.toLowerCase().endsWith(".mp4")) {
           mp4Urls.push(taskData.url);
        }
        
        if (!mp4Urls.length) {
            return bot.sendMessage(chatId, getLang("noVideo"), { reply_to_message_id: msg.message_id });
        }

        // --- Download and send videos ---
        for (const videoUrl of [...new Set(mp4Urls)]) { // Ensure unique URLs again
            const videoPath = path.join(TEMP_DIR, `veo_result_${Date.now()}.mp4`);
            try {
                await downloadFile(videoUrl, videoPath);
                await bot.sendVideo(chatId, videoPath, {}, { contentType: 'video/mp4' });
            } catch (err) {
                console.error("Download/Send Video Error:", err);
                await bot.sendMessage(chatId, getLang("downloadFailed"));
            } finally {
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
            }
        }

    } catch (error) {
        console.error("Main Process Error:", error.response ? error.response.data : error.message);
        await bot.editMessageText(getLang("error"), { chat_id: chatId, message_id: waitingMsg.message_id });
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log("Shutting down bot...");
    process.exit();
});
process.on('SIGTERM', () => {
    console.log("Shutting down bot...");
    process.exit();
});

