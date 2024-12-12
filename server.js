const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
// const { Pool } = require('pg');
const { google } = require("googleapis");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const axios = require("axios");
const generateTranscriptionReport = require("./report.js");
//^ Section 2: Assembly AI handling

require("dotenv").config();
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
async function transcribeFromURL(fileurl) {
  const apikey = ASSEMBLYAI_API_KEY; // replace with your api key

  try {
    const response = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      {
        audio_url: fileurl, // url to the file
      },
      {
        headers: {
          authorization: apikey,
          "content-type": "application/json",
        },
      }
    );

    console.log("transcription request sent. id:", response.data.id);
    return response.data.id; // save the transcript id for status checks
  } catch (error) {
    console.error(
      "error submitting transcription request:",
      error.response.data
    );
  }
}
// Get transcription status and result
// async function getTranscription({ transcriptionId }) {
const getTranscription = async (req, res) => {
  const transcriptionId = req.id; // Retrieve the transcription ID
  try {
    const response = await axios.get(
      `https://api.assemblyai.com/v2/transcript/${transcriptionId}`,
      {
        headers: { authorization: ASSEMBLYAI_API_KEY },
      }
    );

    // Check if the transcription is complete
    if (response.data.status !== "completed") {
      console.log("Transcription is not ready yet:", response.data.status);
      return {
        status: response.data.status,
        message: "Transcription is still processing. Please wait.",
      };
    }

    console.log("Transcription completed successfully:");
    return response.data; // Return the transcription result
  } catch (error) {
    console.error(
      "Error fetching transcription:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      error: "An error occurred while fetching the transcription.",
    });
  }
};

//^ Section 3: PostgreSQL configuration
const app = express();
// app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: "*", // Allow only your frontend
    methods: ["GET", "POST"], // Allow only GET and POST
  })
);

const PORT = 3000;

// Ensure 'uploads' directory exists
const uploadDir = path.join(__dirname, "tmp");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// Load Google Drive credentials
const TOKEN_PATH = path.join(__dirname, "credentials.json");
const CLIENT_SECRET_PATH = path.join(__dirname, "client_secret.json");

let drive;

// Initialize Google Drive API
fs.readFile(CLIENT_SECRET_PATH, (err, content) => {
  if (err) {
    console.error("Error loading client secret file:", err);
    return;
  }
  authorize(JSON.parse(content));
});

function authorize(credentials) {
  const { client_id, client_secret, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) {
      console.error("Error reading token file:", err);
      return;
    }
    oAuth2Client.setCredentials(JSON.parse(token));
    drive = google.drive({ version: "v3", auth: oAuth2Client });
    console.log("Google Drive API initialized successfully.");
  });
}

// Transcode video to MP4 format
function transcodeToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat("mp4")
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

// Upload file to a specific Google Drive folder
async function uploadFileToGoogleDrive(filePath, fileName, folderId) {
  try {
    const fileMetadata = { name: fileName, parents: [folderId] }; // Save in specific folder
    const media = {
      mimeType: "video/mp4",
      body: fs.createReadStream(filePath),
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });

    console.log("Uploaded file ID:", response.data.id);
    return response.data.id;
  } catch (error) {
    console.error("Error uploading file to Google Drive:", error.message);
    throw new Error("Failed to upload to Google Drive");
  }
}
// Helper: Check if a folder exists in Google Drive
async function getOrCreateFolder(folderName, parentFolderId) {
  try {
    // Check if the folder already exists
    const response = await drive.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents`,
      fields: "files(id, name)",
    });

    if (response.data.files.length > 0) {
      // Folder exists, return its ID
      return response.data.files[0].id;
    }

    // Folder doesn't exist, create it
    const fileMetadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    };

    const folder = await drive.files.create({
      resource: fileMetadata,
      fields: "id",
    });

    console.log(`Created folder ${folderName} with ID: ${folder.data.id}`);
    return folder.data.id;
  } catch (error) {
    console.error("Error creating or retrieving folder:", error.message);
    throw new Error("Failed to get or create folder");
  }
}
// Upload JSON file to Google Drive
async function uploadJsonFile(localFilePath, fileName, folderId) {
  console.log(folderId);
  const fileMetadata = {
    name: fileName, // Name of the file in Google Drive
    parents: [folderId],
    mimeType: "application/json",
  };

  const media = {
    mimeType: "application/json",
    body: fs.createReadStream(localFilePath),
  };

  try {
    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });

    console.log("File uploaded successfully! File ID:", response.data.id);
    return response.data.id;
  } catch (error) {
    console.error("Error uploading file:", error.message);
  }
}

//^ lt api
const language = "en"; // Language code for English

async function checkSyntaxAndGrammar(text) {
  try {
    const response = await axios.post(
      "https://api.languagetoolplus.com/v2/check",
      new URLSearchParams({
        text: text,
        language: language,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    // Filter matches to exclude spelling-related issues
    const matches = response.data.matches.filter(
      (match) => match.rule.category.id !== "TYPOS" // Exclude typos/spelling issues
    );

    console.log("Grammar/Syntax Issues Found:", matches.length);

    matches.forEach((match, index) => {
      console.log(`Issue ${index + 1}:`);
      console.log(`- Message: ${match.message}`);
      console.log(
        `- Suggestion: ${match.replacements.map((r) => r.value).join(", ")}`
      );
      console.log(`- Context: ${match.context.text}`);
    });

    return matches.length; // Return the count of grammar/syntax issues
  } catch (error) {
    console.error("Error checking grammar/syntax:", error);
  }
}

// API Route to handle video uploads and transcriptions
app.post("/upload", upload.single("video"), async (req, res) => {
  const { userId, question } = req.body;
  const video = req.file;

  if (!video) {
    return res.status(400).send("No video file uploaded.");
  }

  const filePath = video.path;
  const folderId = "1Eqabl8yhSbMK6zV7PZNdkerXVMIRucDu"; // VideoRep folder ID
  let userFolderId;

  try {
    // Question shorthand mapping
    const questionMap = {
      "Tell us about yourself?": "Q01",
      "What’s your view on remote work culture?": "Q02",
      "How do you stay updated with industry trends?": "Q03",
      "What inspired you to choose your career path?": "Q04",
    };
    const questionCode = questionMap[question];
    if (!questionCode) {
      return res.status(400).send("Invalid question provided.");
    }

    // Get or create user-specific folder
    userFolderId = await getOrCreateFolder(userId.toString(), folderId);

    // Determine the next serial number
    // const serialNo = await getNextSerialNumber(userId, question);
    const serialNo = req.serialNo + 1;

    // Create the file name
    const fileName = `${userId}_${questionCode}_${serialNo}.mp4`;
    const mp4FilePath = path.join(uploadDir, fileName);

    // Convert video to MP4 format
    await transcodeToMp4(filePath, mp4FilePath);

    // Upload MP4 file to user-specific Google Drive folder
    const driveFileId = await uploadFileToGoogleDrive(
      mp4FilePath,
      fileName,
      userFolderId
    );

    // Save the response to the database
    // await saveResponseToDatabase(userId, question, driveFileId);

    // Transcription handling
    const transcriptionResponse = await transcribeFromURL(
      "https://drive.google.com/uc?id=" + driveFileId + "&export=download"
    );
    console.log(transcriptionResponse);

    // Wait for transcription to complete
    let transcriptionResult;
    console.log("Yayyy!");
    while (true) {
      const result = await getTranscription({ id: transcriptionResponse }, res);
      if (result.status === "completed") {
        transcriptionResult = result;
        break;
      } else if (result.status === "failed") {
        throw new Error("Transcription failed");
      } else if (result.status === "error") {
        throw new Error(result.error);
      }
      console.log("Waiting for transcription...");
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
    }

    // Save transcription result as JSON file
    const jsonFilePath = mp4FilePath.replace(".mp4", ".json");
    fs.writeFileSync(
      jsonFilePath,
      JSON.stringify(transcriptionResult, null, 2)
    );
    const JSONFileName = `${userId}_${questionCode}_${serialNo}.json`;
    console.log("Here?");
    const jsonDriveFileId = await uploadJsonFile(
      jsonFilePath,
      JSONFileName,
      userFolderId
    ); // todo : please put in the drive-link and name
    console.log("No, here");

    res.status(200).send({
      file_id: driveFileId, transcript_id: jsonDriveFileId, question: question, user_id: userId
    });

    console.log("1");

    // Delete the original video file
    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting original file:", err);
    });
    fs.unlink(mp4FilePath, (err) => {
      if (err) console.error("Error deleting MP4 file:", err);
    });
    fs.unlink(jsonFilePath, (err) => {
      if (err) console.error("Error deleting JSON file:", err);
    });
    console.log("2");
    return { file_id: driveFileId, transcript_id: jsonDriveFileId, question: question, user_id: userId };
  } catch (error) {
    console.error("Error uploading video or processing transcription:", error);
    res.status(500).send("Failed to upload video or process transcription.");
  }

});
// Middleware to parse JSON and form-data requests
// app.use(express.urlencoded({ extended: true })); For parsing application/x-www-form-urlencoded
// app.use(express.json()); For parsing application/json

app.post("/report", upload.none(), async (req, res) => {
  console.log("Received body:", req.body); // Log the body to check
  try {
    const { transcription_id, question } = req.body;
    transcriptionId = transcription_id;
    if (!transcriptionId) {
      return res.status(400).json({ error: "Missing transcriptionId" });
    }

    const driveJsonFileId = transcription_id;
    const jsonMetaData = await drive.files.get({
      fileId: driveJsonFileId,
      fields: "*",
    });
    const json = await drive.files.get(
      { fileId: driveJsonFileId, alt: "media" },
      { responseType: "stream" }
    );
    const getData = async () => {
      return new Promise((resolve, reject) => {
        let data = "";

        json.data.on("data", (chunk) => {
          data += chunk;
        });

        json.data.on("end", () => {
          try {
            const jsonData = JSON.parse(data); // Assuming you expect the data to be JSON
            resolve(jsonData); // Resolve the promise with the parsed data
          } catch (error) {
            reject(error); // Reject the promise if JSON parsing fails
          }
        });

        json.data.on("error", (err) => {
          reject(err); // Reject if an error occurs while reading the stream
        });
      });
    };
    const completeTextFilePath = "tmp/" + transcription_id + ".txt";

    const processData = async () => {
      try {
        const data = await getData(); // Await the Promise to get the data
        await generateTranscriptionReport(data, completeTextFilePath, question); // Pass the data to your function
      } catch (error) {
        console.error("Error:", error);
      }
    };

    await processData();
    // sending data to frontend

    const filePath = path.join(__dirname, completeTextFilePath);
    const fileName = transcription_id + ".txt";

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);

    readStream.on('error', (err) => {
      console.error('File read error:', err);
      res.status(500).send('An error occurred while streaming the file.');
    });
    console.log("hello is this cumming");
  } catch (error) {
    console.error("Error in /report route:", error);
    return res
      .status(500)
      .json({ error: "An error occurred while processing the report" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);

});
