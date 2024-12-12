const axios = require("axios");

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

    let ans = '';

    matches.forEach((match, index) => {
      ans += `Issue ${index + 1}:\n`;
      ans += `- Message: ${match.message}\n`;
      ans += `- Suggestion: ${match.replacements.map((r) => r.value).join(", ")}\n`;
      ans += `- Context: ${match.context.text}\n`;
    });

    return { count: matches.length, issues: ans }; // Return count and issues for the report
  } catch (error) {
    console.error("Error checking grammar/syntax:", error);
    return { count: 0, issues: "" }; // Return 0 issues if there's an error
  }
}

const fillerWords = [
  "um",
  "uh",
  "like",
  "basically",
  "actually",
  "literally",
  "so",
  "well",
  "yeah",
  "right",
  "ok",
  "hmm",
];

/**
 * Generate and return a transcription report as a JSON object, including LT API results.
 *
 * @param {Object} response - The transcription response object.
 * @param {Array} fillerWords - An array of filler words to check against.
 * @param {string} question - The question related to the transcription.
 * @returns {Object} - The transcription report in JSON format.
 */
async function generateTranscriptionReport(response, question) {
  let report = {
    id: response.id,
    status: response.status,
    audio_url: response.audio_url,
    overall_confidence: (response.confidence * 100).toFixed(2),
    question: question,
    transcript: response.text,
    word_details: {
      filler_words_count: 0,
      unique_vocabulary: 0,
      total_words: 0,
      different_words: [],
    },
    grammar_syntax_issues: {
      count: 0,
      issues: "",
    },
  };

  let fillerCount = 0;
  let vocabulary = 0;
  let totalWords = 0;
  const wordsEncountered = [];

  response.words.forEach((word) => {
    totalWords++;
    if (fillerWords.includes(word.text.toLowerCase())) {
      fillerCount++;
    } else {
      if (!wordsEncountered.includes(word.text.toLowerCase())) {
        vocabulary++;
        wordsEncountered.push(word.text.toLowerCase());
      }
    }
  });

  report.word_details.filler_words_count = fillerCount;
  report.word_details.unique_vocabulary = vocabulary;
  report.word_details.total_words = totalWords;
  report.word_details.different_words = wordsEncountered;

  // Call the LT API to check grammar and syntax
  const { count, issues } = await checkSyntaxAndGrammar(response.text);

  if (count > 0) {
    report.grammar_syntax_issues.count = count;
    report.grammar_syntax_issues.issues = issues;
  } else {
    report.grammar_syntax_issues.count = 0;
    report.grammar_syntax_issues.issues = "No Grammar/Syntax Issues Found.";
  }

  return report; // Return the transcription report as a JSON object
}

module.exports = generateTranscriptionReport;
