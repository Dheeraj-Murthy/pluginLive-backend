const { google } = require("googleapis");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const TOKEN_PATH = path.join(__dirname, "credentials.json"); // Where the token will be saved
const CLIENT_SECRET_PATH = path.join(__dirname, "client_secret.json"); // Path to your client secret JSON file

// Load client secrets
fs.readFile(CLIENT_SECRET_PATH, (err, content) => {
  if (err) {
    console.error("Error loading client secret file:", err);
    return;
  }
  authorize(JSON.parse(content), getAccessToken);
});

// Authorize client
function authorize(credentials, callback) {
  const { client_id, client_secret, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Check if token is already stored
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) {
      return callback(oAuth2Client);
    }
    oAuth2Client.setCredentials(JSON.parse(token));
    console.log("Token already exists:", TOKEN_PATH);
  });
}

// Get new token
function getAccessToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("Authorize this app by visiting this URL:", authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) {
        console.error("Error retrieving access token", err);
        return;
      }
      oAuth2Client.setCredentials(token);

      // Save the token
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) console.error("Error saving token", err);
        console.log("Token stored to", TOKEN_PATH);
      });
    });
  });
}
